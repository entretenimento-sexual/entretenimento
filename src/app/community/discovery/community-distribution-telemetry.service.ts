import { DestroyRef, Injectable, Injector, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Subject,
  bufferTime,
  catchError,
  concatMap,
  defer,
  filter,
  tap,
} from 'rxjs';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import {
  CommunityDistributionTelemetryEvent,
  CommunityDistributionTelemetryEventType,
  CommunityDistributionTelemetryRepository,
  CommunityDistributionTelemetrySurface,
} from '../data-access/community-distribution-telemetry.repository';

const BATCH_INTERVAL_MS = 1_200;
const BATCH_SIZE = 12;
const INITIAL_RETRY_DELAY_MS = 60_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

interface SessionDistributionEvent extends CommunityDistributionTelemetryEvent {
  readonly viewerUid: string;
  readonly viewerSession: number;
}

@Injectable({ providedIn: 'root' })
export class CommunityDistributionTelemetryService {
  private readonly injector = inject(Injector);
  private readonly destroyRef = inject(DestroyRef);
  private readonly session = inject(AuthSessionService);
  private readonly events$ = new Subject<SessionDistributionEvent>();
  private readonly recordedThisSession = new Set<string>();
  private activeViewerUid: string | null = null;
  private activeViewerSession = 0;
  private telemetryDisabledUntil = 0;
  private retryDelayMs = INITIAL_RETRY_DELAY_MS;

  constructor() {
    this.session.readyUid$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((uid) => {
        const viewerUid = String(uid ?? '').trim() || null;
        if (viewerUid === this.activeViewerUid) return;

        this.activeViewerUid = viewerUid;
        this.activeViewerSession += 1;
        this.recordedThisSession.clear();
        this.closeCircuit();
      });

    this.events$.pipe(
      bufferTime(BATCH_INTERVAL_MS, undefined, BATCH_SIZE),
      filter((batch) => batch.length > 0),
      concatMap((batch) => this.persistBatch$(batch)),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  recordQualifiedExposure(
    communityId: string,
    surface: CommunityDistributionTelemetrySurface
  ): void {
    this.record(communityId, surface, 'qualified_exposure');
  }

  recordOpen(
    communityId: string,
    surface: CommunityDistributionTelemetrySurface
  ): void {
    this.record(communityId, surface, 'open');
  }

  private record(
    communityIdValue: string,
    surface: CommunityDistributionTelemetrySurface,
    eventType: CommunityDistributionTelemetryEventType
  ): void {
    if (this.isTemporarilyDisabled()) return;

    const viewerUid = this.activeViewerUid;
    if (!viewerUid) return;

    const communityId = String(communityIdValue ?? '').trim();
    if (!communityId) return;

    const viewerSession = this.activeViewerSession;
    const sessionKey =
      `${viewerSession}:${eventType}:${surface}:${communityId}`;
    if (this.recordedThisSession.has(sessionKey)) return;

    this.recordedThisSession.add(sessionKey);
    this.events$.next({
      viewerUid,
      viewerSession,
      communityId,
      surface,
      eventType,
    });
  }

  private persistBatch$(batch: readonly SessionDistributionEvent[]) {
    const viewerUid = this.activeViewerUid;
    const viewerSession = this.activeViewerSession;
    if (!viewerUid) return EMPTY;

    const events = batch
      .filter(
        (entry) =>
          entry.viewerUid === viewerUid
          && entry.viewerSession === viewerSession
      )
      .map(({ communityId, surface, eventType }) => ({
        communityId,
        surface,
        eventType,
      }));

    if (events.length === 0) return EMPTY;

    return defer(() => {
      if (
        this.isTemporarilyDisabled()
        || this.activeViewerUid !== viewerUid
        || this.activeViewerSession !== viewerSession
      ) {
        return EMPTY;
      }

      const repository = this.injector.get(
        CommunityDistributionTelemetryRepository
      );
      const applicationError = this.injector.get(ApplicationErrorService);

      return repository.recordEvents$(events).pipe(
        tap(() => this.closeCircuit()),
        catchError((error: unknown) => {
          const retryDelayMs = this.openCircuit();

          applicationError.report(error, {
            feature: 'community',
            operation: 'recordDistributionTelemetry',
            fallbackMessage:
              'Não foi possível registrar a telemetria de distribuição.',
            notification: 'none',
            metadata: {
              eventCount: events.length,
              retryDelayMs,
            },
          });

          return EMPTY;
        })
      );
    });
  }

  private isTemporarilyDisabled(now = Date.now()): boolean {
    return this.telemetryDisabledUntil > now;
  }

  private openCircuit(now = Date.now()): number {
    const retryDelayMs = this.retryDelayMs;
    this.telemetryDisabledUntil = now + retryDelayMs;
    this.retryDelayMs = Math.min(retryDelayMs * 2, MAX_RETRY_DELAY_MS);
    return retryDelayMs;
  }

  private closeCircuit(): void {
    this.telemetryDisabledUntil = 0;
    this.retryDelayMs = INITIAL_RETRY_DELAY_MS;
  }
}
