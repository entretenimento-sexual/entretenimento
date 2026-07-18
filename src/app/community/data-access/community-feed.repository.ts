// src/app/community/data-access/community-feed.repository.ts
// -----------------------------------------------------------------------------
// COMMUNITY FEED REPOSITORY
// -----------------------------------------------------------------------------
// `defer` impede requisição antes de a seção autorizada receber assinatura.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityFeedPage,
  CommunityFeedPageRequest,
  normalizeCommunityFeedPageResponse,
} from './community-feed.model';

@Injectable({ providedIn: 'root' })
export class CommunityFeedRepository {
  private readonly functions = inject(Functions);

  private readonly getCommunityFeedPageCallable = httpsCallable<
    CommunityFeedPageRequest,
    unknown
  >(this.functions, 'getCommunityFeedPage');

  getPage$(request: CommunityFeedPageRequest): Observable<CommunityFeedPage> {
    const payload: CommunityFeedPageRequest = {
      communityId: request.communityId.trim(),
      view: request.view,
      limit: request.limit ?? 10,
      cursor: request.cursor ?? null,
    };

    return defer(() => from(this.getCommunityFeedPageCallable(payload))).pipe(
      map((result) => normalizeCommunityFeedPageResponse(result.data))
    );
  }
}
