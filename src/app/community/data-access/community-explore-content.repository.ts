// src/app/community/data-access/community-explore-content.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityExploreContentResponse,
  normalizeCommunityExploreContentResponse,
} from './community-explore-content.model';

@Injectable({ providedIn: 'root' })
export class CommunityExploreContentRepository {
  private readonly functions = inject(Functions);
  private readonly getContentCallable = httpsCallable<
    { limit: number },
    unknown
  >(this.functions, 'getCommunityExploreContent');

  getContent$(limit = 2): Observable<CommunityExploreContentResponse> {
    const normalizedLimit = Math.min(
      Math.max(Math.trunc(Number(limit)) || 2, 1),
      2
    );

    return defer(() =>
      from(this.getContentCallable({ limit: normalizedLimit }))
    ).pipe(
      map((result) => normalizeCommunityExploreContentResponse(result.data))
    );
  }
}
