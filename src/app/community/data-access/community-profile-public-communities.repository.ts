import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { SessionReadInFlight } from '@core/services/autentication/auth/session-read-in-flight';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityDiscoveryPage,
  normalizeCommunityDiscoveryPageResponse,
} from './community-preview.model';

@Injectable({ providedIn: 'root' })
export class CommunityProfilePublicCommunitiesRepository {
  private readonly functions = inject(Functions);
  private readonly session = inject(AuthSessionService);
  private readonly inFlight = new SessionReadInFlight<unknown>(this.session);

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

    const payload = {
      profileId: String(profileId ?? '').trim().toLowerCase(),
      limit: normalizedLimit,
      cursor: normalizedCursor,
    };
    return this.inFlight.read$(
      JSON.stringify(payload),
      () => defer(() => from(this.getProfilePublicCommunitiesCallable(payload))).pipe(map(result => result.data))
    ).pipe(map(normalizeCommunityDiscoveryPageResponse));
  }
}
