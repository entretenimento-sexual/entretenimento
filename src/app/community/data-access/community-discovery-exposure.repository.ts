// src/app/community/data-access/community-discovery-exposure.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import { CommunityPreviewSourceType } from './community-preview.model';

export interface CommunityDiscoveryExposureResponse {
  readonly accepted: number;
  readonly generatedAt: number;
}

interface CommunityDiscoveryExposureRequest {
  readonly sourceType: CommunityPreviewSourceType;
  readonly communityIds: readonly string[];
}

function normalizeResponse(
  raw: unknown,
  submittedCount: number
): CommunityDiscoveryExposureResponse {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const acceptedRaw = Math.trunc(Number(source['accepted']));
  const generatedAtRaw = Math.trunc(Number(source['generatedAt']));

  return {
    accepted: Number.isFinite(acceptedRaw)
      ? Math.min(Math.max(acceptedRaw, 0), submittedCount)
      : 0,
    generatedAt: Number.isFinite(generatedAtRaw) && generatedAtRaw > 0
      ? generatedAtRaw
      : Date.now(),
  };
}

@Injectable({ providedIn: 'root' })
export class CommunityDiscoveryExposureRepository {
  private readonly functions = inject(Functions);
  private readonly recordCallable = httpsCallable<
    CommunityDiscoveryExposureRequest,
    unknown
  >(this.functions, 'recordCommunityDiscoveryExposure');

  recordQualifiedExposure$(input: {
    sourceType: CommunityPreviewSourceType;
    communityIds: readonly string[];
  }): Observable<CommunityDiscoveryExposureResponse> {
    const communityIds = [...new Set(
      input.communityIds
        .map((communityId) => String(communityId ?? '').trim())
        .filter(Boolean)
    )].slice(0, 12);

    return defer(() =>
      from(this.recordCallable({
        sourceType: input.sourceType,
        communityIds,
      }))
    ).pipe(
      map((result) => normalizeResponse(result.data, communityIds.length))
    );
  }
}
