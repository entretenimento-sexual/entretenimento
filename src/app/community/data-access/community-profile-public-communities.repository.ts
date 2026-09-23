import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityDiscoveryPage,
  normalizeCommunityDiscoveryPageResponse,
} from './community-preview.model';

@Injectable({ providedIn: 'root' })
export class CommunityProfilePublicCommunitiesRepository {
  private readonly functions = inject(Functions);

  private readonly getProfilePublicCommunitiesCallable = httpsCallable<
    { profileId: string; limit: number; cursor: string | null },
    unknown
  >(this.functions, 'getProfilePublicCommunities');

  getProfilePublicCommunities$(
    profileId: string,
    limit = 4,
    cursor: string | null = null
  ): Observable<CommunityDiscoveryPage> {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 12);
    const normalizedCursor = String(cursor ?? '').trim() || null;

    return defer(() => from(this.getProfilePublicCommunitiesCallable({
      profileId: String(profileId ?? '').trim().toLowerCase(),
      limit: normalizedLimit,
      cursor: normalizedCursor,
    }))).pipe(
      map((result) => normalizeCommunityDiscoveryPageResponse(result.data))
    );
  }
}
