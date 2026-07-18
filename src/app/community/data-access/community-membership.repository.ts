// src/app/community/data-access/community-membership.repository.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP REPOSITORY
// -----------------------------------------------------------------------------
// Adapter lazy para a callable. O cliente nunca grava membership no Firestore.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable } from 'rxjs';

import {
  CommunityMembershipRequestResponse,
  normalizeCommunityMembershipResponse,
} from './community-membership.model';

@Injectable({ providedIn: 'root' })
export class CommunityMembershipRepository {
  private readonly functions = inject(Functions);

  private readonly requestMembershipCallable = httpsCallable<
    { communityId: string },
    unknown
  >(this.functions, 'requestCommunityMembership');

  requestMembership$(
    communityId: string
  ): Observable<CommunityMembershipRequestResponse> {
    return defer(() =>
      from(this.requestMembershipCallable({ communityId: communityId.trim() }))
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityMembershipResponse(result.data);

        if (!normalized) {
          throw new Error('Resposta de membership comunitária inválida.');
        }

        return normalized;
      })
    );
  }
}
