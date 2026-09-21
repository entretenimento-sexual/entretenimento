// src/app/community/data-access/community-boost.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunitySponsoredPlacement,
  normalizeCommunitySponsoredPlacement,
} from './community-boost.model';
import type { CommunityPreviewSourceType } from './community-preview.model';

export type CommunityBoostEventType = 'qualified_exposure' | 'click';

export interface CommunityBoostEventResponse {
  readonly accepted: boolean;
  readonly idempotent: boolean;
  readonly billable: boolean;
}

@Injectable({ providedIn: 'root' })
export class CommunityBoostRepository {
  private readonly functions = inject(Functions);

  private readonly getPlacementCallable = httpsCallable<
    {
      sourceType: CommunityPreviewSourceType;
      tagId: string | null;
      organicCommunityIds: readonly string[];
      excludedCommunityIds: readonly string[];
    },
    unknown
  >(this.functions, 'getCommunityBoostPlacement');

  private readonly recordEventCallable = httpsCallable<
    { placementId: string; event: CommunityBoostEventType },
    unknown
  >(this.functions, 'recordCommunityBoostEvent');

  getPlacement$(input: {
    sourceType: CommunityPreviewSourceType;
    tagId: string | null;
    organicCommunityIds: readonly string[];
    excludedCommunityIds?: readonly string[];
  }): Observable<CommunitySponsoredPlacement | null> {
    const organicCommunityIds = [...new Set(
      input.organicCommunityIds
        .map((communityId) => String(communityId ?? '').trim())
        .filter(Boolean)
    )].slice(0, 24);
    const excludedCommunityIds = [...new Set(
      (input.excludedCommunityIds ?? [])
        .map((communityId) => String(communityId ?? '').trim())
        .filter(Boolean)
    )].slice(0, 24);

    return defer(() =>
      from(this.getPlacementCallable({
        sourceType: input.sourceType,
        tagId: input.tagId,
        organicCommunityIds,
        excludedCommunityIds,
      }))
    ).pipe(
      map((result) => {
        const source = result.data && typeof result.data === 'object'
          ? result.data as Record<string, unknown>
          : {};
        return normalizeCommunitySponsoredPlacement(source['placement']);
      })
    );
  }

  recordEvent$(
    placementIdValue: string,
    event: CommunityBoostEventType
  ): Observable<CommunityBoostEventResponse> {
    const placementId = String(placementIdValue ?? '').trim();

    return defer(() =>
      from(this.recordEventCallable({ placementId, event }))
    ).pipe(
      map((result) => {
        const source = result.data && typeof result.data === 'object'
          ? result.data as Record<string, unknown>
          : {};
        return {
          accepted: source['accepted'] === true,
          idempotent: source['idempotent'] === true,
          billable: source['billable'] === true,
        };
      })
    );
  }
}
