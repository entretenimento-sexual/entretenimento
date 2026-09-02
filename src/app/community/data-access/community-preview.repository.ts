// src/app/community/data-access/community-preview.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map, of } from 'rxjs';

import type {
  CommunityOfficialTargetType,
} from 'src/app/core/community/community-official-association.model';
import { normalizeCommunityDiscoveryPageSize } from './community-discovery.contract';
import {
  CommunityDiscoveryPage,
  CommunityDiscoveryPageRequest,
  CommunityPreviewResponse,
  normalizeCommunityDiscoveryPageResponse,
  normalizeCommunityPreviewResponse,
} from './community-preview.model';

interface OfficialCommunitiesTarget {
  readonly type: CommunityOfficialTargetType;
  readonly id: string;
}

@Injectable({ providedIn: 'root' })
export class CommunityPreviewRepository {
  private readonly functions = inject(Functions);

  private readonly getDiscoveryPageCallable = httpsCallable<
    CommunityDiscoveryPageRequest,
    unknown
  >(this.functions, 'getCommunityDiscoveryPage');

  private readonly getMyCommunitiesPageCallable = httpsCallable<
    CommunityDiscoveryPageRequest,
    unknown
  >(this.functions, 'getMyCommunitiesPage');

  private readonly getOfficialCommunitiesForTargetCallable = httpsCallable<
    { target: OfficialCommunitiesTarget; limit?: number },
    unknown
  >(this.functions, 'getOfficialCommunitiesForTarget');

  private readonly getPreviewCallable = httpsCallable<
    { communityId: string },
    unknown
  >(this.functions, 'getCommunityPreview');

  getDiscoveryPage$(
    request: CommunityDiscoveryPageRequest = {}
  ): Observable<CommunityDiscoveryPage> {
    return defer(() =>
      from(
        this.getDiscoveryPageCallable({
          limit: normalizeCommunityDiscoveryPageSize(request.limit),
          cursor: request.cursor ?? null,
          sourceType: request.sourceType ?? null,
          tagId: request.tagId ?? null,
        })
      )
    ).pipe(
      map((result) => normalizeCommunityDiscoveryPageResponse(result.data))
    );
  }

  getMyCommunitiesPage$(
    request: CommunityDiscoveryPageRequest = {}
  ): Observable<CommunityDiscoveryPage> {
    return defer(() =>
      from(
        this.getMyCommunitiesPageCallable({
          limit: normalizeCommunityDiscoveryPageSize(request.limit),
          cursor: request.cursor ?? null,
        })
      )
    ).pipe(
      map((result) => normalizeCommunityDiscoveryPageResponse(result.data))
    );
  }

  getOfficialCommunitiesForTarget$(
    target: OfficialCommunitiesTarget,
    limit = 4
  ): Observable<CommunityDiscoveryPage> {
    const targetId = String(target?.id ?? '').trim();
    if (!targetId) {
      return of(this.emptyDiscoveryPage());
    }

    return defer(() =>
      from(
        this.getOfficialCommunitiesForTargetCallable({
          target: {
            type: target.type,
            id: targetId,
          },
          limit: this.normalizeLimit(limit),
        })
      )
    ).pipe(
      map((result) => normalizeCommunityDiscoveryPageResponse(result.data))
    );
  }

  getProfileOfficialCommunities$(
    profileId: string,
    limit = 4
  ): Observable<CommunityDiscoveryPage> {
    const normalizedProfileId = String(profileId ?? '').trim().toLowerCase();
    if (!normalizedProfileId) {
      return of(this.emptyDiscoveryPage());
    }

    return this.getOfficialCommunitiesForTarget$(
      { type: 'profile', id: normalizedProfileId },
      limit
    );
  }

  getPreview$(communityId: string): Observable<CommunityPreviewResponse> {
    return defer(() =>
      from(this.getPreviewCallable({ communityId: communityId.trim() }))
    ).pipe(
      map((result) => {
        const preview = normalizeCommunityPreviewResponse(result.data);

        if (!preview) {
          throw new Error('Resposta de comunidade inválida.');
        }

        return preview;
      })
    );
  }

  private normalizeLimit(limit: number): number {
    const parsed = Math.trunc(Number(limit));
    return Number.isFinite(parsed)
      ? Math.min(Math.max(parsed, 1), 12)
      : 4;
  }

  private emptyDiscoveryPage(): CommunityDiscoveryPage {
    return {
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    };
  }
}
