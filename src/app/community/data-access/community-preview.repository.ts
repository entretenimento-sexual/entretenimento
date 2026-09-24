// src/app/community/data-access/community-preview.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map, of } from 'rxjs';

import { normalizeCommunityDiscoveryPageSize } from './community-discovery.contract';
import {
  CommunityOfficialTarget,
  normalizeCommunityOfficialTarget,
  retainCommunitiesForOfficialTarget,
} from './community-official-target.policy';
import {
  CommunityDiscoveryPage,
  CommunityDiscoveryPageRequest,
  CommunityPreviewResponse,
  normalizeCommunityDiscoveryPageResponse,
  normalizeCommunityPreviewResponse,
} from './community-preview.model';
import { sanitizeCommunityPublicDiscoveryPage } from './community-public-visibility.policy';

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
    { target: CommunityOfficialTarget; limit?: number },
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
          excludeActiveMemberships:
            request.excludeActiveMemberships === true,
        })
      )
    ).pipe(
      map((result) => normalizeCommunityDiscoveryPageResponse(result.data)),
      map(sanitizeCommunityPublicDiscoveryPage)
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
    target: CommunityOfficialTarget,
    limit = 4
  ): Observable<CommunityDiscoveryPage> {
    const normalizedTarget = normalizeCommunityOfficialTarget(target);
    if (!normalizedTarget) {
      return of(this.emptyDiscoveryPage());
    }

    return defer(() =>
      from(
        this.getOfficialCommunitiesForTargetCallable({
          target: normalizedTarget,
          limit: this.normalizeLimit(limit),
        })
      )
    ).pipe(
      map((result) => normalizeCommunityDiscoveryPageResponse(result.data)),
      map(sanitizeCommunityPublicDiscoveryPage),
      map((page) => retainCommunitiesForOfficialTarget(page, normalizedTarget))
    );
  }

  /**
   * Compatibilidade para consumidores antigos. Novas superfícies devem usar o
   * contrato genérico getOfficialCommunitiesForTarget$.
   */
  getProfileOfficialCommunities$(
    profileId: string,
    limit = 4
  ): Observable<CommunityDiscoveryPage> {
    const normalizedTarget = normalizeCommunityOfficialTarget({
      type: 'profile',
      id: profileId,
    });
    if (!normalizedTarget) {
      return of(this.emptyDiscoveryPage());
    }

    return this.getOfficialCommunitiesForTarget$(normalizedTarget, limit);
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
