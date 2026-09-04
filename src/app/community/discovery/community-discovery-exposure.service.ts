// src/app/community/discovery/community-discovery-exposure.service.ts
import { DestroyRef, Injectable, Injector, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Subject,
  bufferTime,
  catchError,
  concat,
  concatMap,
  defer,
  filter,
  tap,
} from 'rxjs';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityDiscoveryExposureRepository } from '../data-access/community-discovery-exposure.repository';
import { CommunityPreviewSourceType } from '../data-access/community-preview.model';

const EXPOSURE_BATCH_INTERVAL_MS = 1_200;
const EXPOSURE_BATCH_SIZE = 12;
const EXPOSURE_INITIAL_RETRY_DELAY_MS = 60_000;
const EXPOSURE_MAX_RETRY_DELAY_MS = 15 * 60_000;

interface QualifiedExposure {
  readonly viewerUid: string;
  readonly viewerSession: number;
  readonly communityId: string;
  readonly sourceType: CommunityPreviewSourceType;
}

@Injectable({ providedIn: 'root' })
export class CommunityDiscoveryExposureService {
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(AuthSessionService);
  private readonly qualifiedExposure$ = new Subject<QualifiedExposure>();
  private readonly recordedThisSession = new Set<string>();
  private activeViewerUid: string | null = null;
  private activeViewerSession = 0;
  private telemetryDisabledUntil = 0;
  private retryDelayMs = EXPOSURE_INITIAL_RETRY_DELAY_MS;

  constructor() {
    this.session.readyUid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        const viewerUid = String(uid ?? '').trim() || null;
        if (viewerUid === this.activeViewerUid) return;

        this.activeViewerUid = viewerUid;
        this.activeViewerSession += 1;
        this.recordedThisSession.clear();
        this.closeTelemetryCircuit();
      });

    this.qualifiedExposure$.pipe(
      bufferTime(EXPOSURE_BATCH_INTERVAL_MS, undefined, EXPOSURE_BATCH_SIZE),
      filter((batch) => batch.length > 0),
      concatMap((batch) => this.persistBatch$(batch)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  recordQualifiedExposure(
    communityId: string,
    sourceType: CommunityPreviewSourceType
  ): void {
    if (this.isTelemetryTemporarilyDisabled()) return;

    const viewerUid = this.activeViewerUid;
    if (!viewerUid) return;

    const normalizedId = String(communityId ?? '').trim();
    if (!normalizedId) return;

    const viewerSession = this.activeViewerSession;
    const sessionKey = `${viewerSession}:${sourceType}:${normalizedId}`;
    if (this.recordedThisSession.has(sessionKey)) return;

    this.recordedThisSession.add(sessionKey);
    this.qualifiedExposure$.next({
      viewerUid,
      viewerSession,
      communityId: normalizedId,
      sourceType,
    });
  }

  private persistBatch$(batch: readonly QualifiedExposure[]) {
    const viewerUid = this.activeViewerUid;
    const viewerSession = this.activeViewerSession;
    if (!viewerUid) return EMPTY;

    const activeBatch = batch.filter(
      (entry) =>
        entry.viewerUid === viewerUid
        && entry.viewerSession === viewerSession
    );
    if (activeBatch.length === 0) return EMPTY;

    const communityIds = activeBatch
      .filter((entry) => entry.sourceType === 'community')
      .map((entry) => entry.communityId);
    const venueIds = activeBatch
      .filter((entry) => entry.sourceType === 'venue')
      .map((entry) => entry.communityId);
    const requests = [
      communityIds.length > 0
        ? this.persistSourceBatch$(
          'community',
          communityIds,
          viewerUid,
          viewerSession
        )
        : EMPTY,
      venueIds.length > 0
        ? this.persistSourceBatch$(
          'venue',
          venueIds,
          viewerUid,
          viewerSession
        )
        : EMPTY,
    ];

    return concat(...requests);
  }

  private persistSourceBatch$(
    sourceType: CommunityPreviewSourceType,
    communityIds: readonly string[],
    viewerUid: string,
    viewerSession: number
  ) {
    return defer(() => {
      if (
        this.isTelemetryTemporarilyDisabled()
        || this.activeViewerUid !== viewerUid
        || this.activeViewerSession !== viewerSession
      ) {
        return EMPTY;
      }

      const repository = this.injector.get(CommunityDiscoveryExposureRepository);
      const applicationError = this.injector.get(ApplicationErrorService);

      return repository.recordQualifiedExposure$({
        sourceType,
        communityIds,
      }).pipe(
        tap(() => this.closeTelemetryCircuit()),
        catchError((error: unknown) => {
          const retryDelayMs = this.openTelemetryCircuit();

          applicationError.report(error, {
            feature: 'community',
            operation: 'recordDiscoveryExposure',
            fallbackMessage: 'Não foi possível registrar a telemetria de descoberta.',
            notification: 'none',
            metadata: {
              sourceType,
              batchSize: communityIds.length,
              retryDelayMs,
            },
          });
          return EMPTY;
        })
      );
    });
  }

  private isTelemetryTemporarilyDisabled(now = Date.now()): boolean {
    return this.telemetryDisabledUntil > now;
  }

  private openTelemetryCircuit(now = Date.now()): number {
    const retryDelayMs = this.retryDelayMs;
    this.telemetryDisabledUntil = now + retryDelayMs;
    this.retryDelayMs = Math.min(
      retryDelayMs * 2,
      EXPOSURE_MAX_RETRY_DELAY_MS
    );
    return retryDelayMs;
  }

  private closeTelemetryCircuit(): void {
    this.telemetryDisabledUntil = 0;
    this.retryDelayMs = EXPOSURE_INITIAL_RETRY_DELAY_MS;
  }
}
