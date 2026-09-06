import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map } from 'rxjs';

import {
  CommunityMembershipDisclosureMode,
  CommunityMembershipDisclosureUpdateResult,
  CommunityMembershipProfileVisibility,
  CommunityMembershipProfileVisibilityState,
  normalizeCommunityMembershipDisclosureUpdateResult,
  normalizeCommunityMembershipProfileVisibilityState,
} from './community-membership-profile-visibility.model';

@Injectable({ providedIn: 'root' })
export class CommunityMembershipProfileVisibilityRepository {
  private readonly functions = inject(Functions);

  private readonly getCallable = httpsCallable<
    { communityId: string },
    unknown
  >(this.functions, 'getCommunityMembershipProfileVisibility');

  private readonly updateCallable = httpsCallable<
    {
      communityId: string;
      profileVisibility: CommunityMembershipProfileVisibility;
    },
    unknown
  >(this.functions, 'updateCommunityMembershipProfileVisibility');

  private readonly updateDisclosureCallable = httpsCallable<
    { communityId: string; mode: CommunityMembershipDisclosureMode },
    unknown
  >(this.functions, 'updateCommunityMembershipDisclosurePolicy');

  getState$(communityId: string): Observable<CommunityMembershipProfileVisibilityState> {
    return defer(() => from(this.getCallable({ communityId }))).pipe(
      map((result) => {
        const normalized = normalizeCommunityMembershipProfileVisibilityState(
          result.data
        );
        if (!normalized) {
          throw new Error('Resposta de privacidade da participação inválida.');
        }
        return normalized;
      })
    );
  }

  updateVisibility$(
    communityId: string,
    profileVisibility: CommunityMembershipProfileVisibility
  ): Observable<CommunityMembershipProfileVisibilityState> {
    return defer(() => from(this.updateCallable({
      communityId,
      profileVisibility,
    }))).pipe(
      map((result) => {
        const normalized = normalizeCommunityMembershipProfileVisibilityState(
          result.data
        );
        if (!normalized) {
          throw new Error('Resposta de atualização da privacidade inválida.');
        }
        return normalized;
      })
    );
  }

  updateDisclosure$(
    communityId: string,
    mode: CommunityMembershipDisclosureMode
  ): Observable<CommunityMembershipDisclosureUpdateResult> {
    return defer(() => from(this.updateDisclosureCallable({ communityId, mode }))).pipe(
      map((result) => {
        const normalized = normalizeCommunityMembershipDisclosureUpdateResult(
          result.data
        );
        if (!normalized) {
          throw new Error('Resposta da política de privacidade inválida.');
        }
        return normalized;
      })
    );
  }
}
