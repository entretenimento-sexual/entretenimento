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
    { profileUid: string; limit: number },
    unknown
  >(this.functions, 'getProfilePublicCommunities');

  getProfilePublicCommunities$(
    profileUid: string,
    limit = 4
  ): Observable<CommunityDiscoveryPage> {
    const normalizedLimit = Math.min(Math.max(Math.trunc(limit), 1), 12);
    return defer(() => from(this.getProfilePublicCommunitiesCallable({
      profileUid: String(profileUid ?? '').trim(),
      limit: normalizedLimit,
    }))).pipe(
      map((result) => normalizeCommunityDiscoveryPageResponse(result.data))
    );
  }
}
