// src/app/community/discovery/community-discovery-exposure.service.ts
import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  EMPTY,
  Subject,
  bufferTime,
  catchError,
  concat,
  concatMap,
  filter,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityDiscoveryExposureRepository } from '../data-access/community-discovery-exposure.repository';
import { CommunityPreviewSourceType } from '../data-access/community-preview.model';

const EXPOSURE_BATCH_INTERVAL_MS = 1_200;
const EXPOSURE_BATCH_SIZE = 12;

interface QualifiedExposure {
  readonly communityId: string;
  readonly sourceType: CommunityPreviewSourceType;
}

@Injectable({ providedIn: 'root' })
export class CommunityDiscoveryExposureService {
  private readonly repository = inject(CommunityDiscoveryExposureRepository);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly qualifiedExposure$ = new Subject<QualifiedExposure>();
  private readonly recordedThisSession = new Set<string>();

  constructor() {
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
    const normalizedId = String(communityId ?? '').trim();
    if (!normalizedId) return;

    const sessionKey = `${sourceType}:${normalizedId}`;
    if (this.recordedThisSession.has(sessionKey)) return;

    this.recordedThisSession.add(sessionKey);
    this.qualifiedExposure$.next({
      communityId: normalizedId,
      sourceType,
    });
  }

  private persistBatch$(batch: readonly QualifiedExposure[]) {
    const communityIds = batch
      .filter((entry) => entry.sourceType === 'community')
      .map((entry) => entry.communityId);
    const venueIds = batch
      .filter((entry) => entry.sourceType === 'venue')
      .map((entry) => entry.communityId);
    const requests = [
      communityIds.length > 0
        ? this.persistSourceBatch$('community', communityIds)
        : EMPTY,
      venueIds.length > 0
        ? this.persistSourceBatch$('venue', venueIds)
        : EMPTY,
    ];

    return concat(...requests);
  }

  private persistSourceBatch$(
    sourceType: CommunityPreviewSourceType,
    communityIds: readonly string[]
  ) {
    return this.repository.recordQualifiedExposure$({
      sourceType,
      communityIds,
    }).pipe(
      catchError((error: unknown) => {
        this.applicationError.report(error, {
          feature: 'community',
          operation: 'recordDiscoveryExposure',
          fallbackMessage: 'Não foi possível registrar a telemetria de descoberta.',
          notification: 'none',
          metadata: {
            sourceType,
            batchSize: communityIds.length,
          },
        });
        return EMPTY;
      })
    );
  }
}
