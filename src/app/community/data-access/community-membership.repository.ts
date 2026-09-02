// src/app/community/data-access/community-membership.repository.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP REPOSITORY
// -----------------------------------------------------------------------------
// Adapter lazy para callables. O cliente nunca grava ou lista memberships no
// Firestore diretamente.
// -----------------------------------------------------------------------------

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable, tap } from 'rxjs';

import { CommunityDiscoveryCacheService } from '../discovery/community-discovery-cache.service';
import { CommunityDiscoverySessionBehaviorService } from '../discovery/community-discovery-session-behavior.service';
import {
  CommunityMembershipRequestResponse,
  CommunityMembershipRequestsResponse,
  CommunityMembershipReviewAction,
  CommunityMembershipReviewResponse,
  normalizeCommunityMembershipRequestsResponse,
  normalizeCommunityMembershipResponse,
  normalizeCommunityMembershipReviewResponse,
} from './community-membership.model';

@Injectable({ providedIn: 'root' })
export class CommunityMembershipRepository {
  private readonly functions = inject(Functions);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);
  private readonly sessionBehavior = inject(
    CommunityDiscoverySessionBehaviorService
  );

  private readonly requestMembershipCallable = httpsCallable<
    { communityId: string },
    unknown
  >(this.functions, 'requestCommunityMembership');

  private readonly leaveMembershipCallable = httpsCallable<
    { communityId: string },
    unknown
  >(this.functions, 'leaveCommunityMembership');

  private readonly getMembershipRequestsCallable = httpsCallable<
    { communityId: string },
    unknown
  >(this.functions, 'getCommunityMembershipRequests');

  private readonly reviewMembershipCallable = httpsCallable<
    {
      communityId: string;
      memberId: string;
      action: CommunityMembershipReviewAction;
    },
    unknown
  >(this.functions, 'reviewCommunityMembership');

  requestMembership$(
    communityId: string
  ): Observable<CommunityMembershipRequestResponse> {
    const normalizedCommunityId = communityId.trim();

    return defer(() =>
      from(this.requestMembershipCallable({ communityId: normalizedCommunityId }))
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityMembershipResponse(result.data);

        if (!normalized || normalized.status === 'left') {
          throw new Error('Resposta de adesão comunitária inválida.');
        }

        return normalized;
      }),
      tap((result) => {
        if (result.status === 'active') {
          this.sessionBehavior.setMembershipActive(normalizedCommunityId, true);
        }
        this.discoveryCache.invalidateCurrentViewer({
          sourceType: 'community',
        });
      })
    );
  }

  leaveMembership$(
    communityId: string
  ): Observable<CommunityMembershipRequestResponse> {
    const normalizedCommunityId = communityId.trim();

    return defer(() =>
      from(this.leaveMembershipCallable({ communityId: normalizedCommunityId }))
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityMembershipResponse(result.data);

        if (!normalized || normalized.status !== 'left') {
          throw new Error('Resposta de saída comunitária inválida.');
        }

        return normalized;
      }),
      tap(() => {
        this.sessionBehavior.setMembershipActive(normalizedCommunityId, false);
        this.discoveryCache.invalidateCurrentViewer({
          sourceType: 'community',
        });
      })
    );
  }

  getMembershipRequests$(
    communityId: string
  ): Observable<CommunityMembershipRequestsResponse> {
    return defer(() =>
      from(
        this.getMembershipRequestsCallable({ communityId: communityId.trim() })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityMembershipRequestsResponse(
          result.data
        );

        if (!normalized) {
          throw new Error('Fila comunitária inválida.');
        }

        return normalized;
      })
    );
  }

  reviewMembership$(
    communityId: string,
    memberId: string,
    action: CommunityMembershipReviewAction
  ): Observable<CommunityMembershipReviewResponse> {
    return defer(() =>
      from(
        this.reviewMembershipCallable({
          communityId: communityId.trim(),
          memberId: memberId.trim(),
          action,
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityMembershipReviewResponse(
          result.data
        );

        if (!normalized) {
          throw new Error('Resposta de moderação comunitária inválida.');
        }

        return normalized;
      }),
      tap(() => this.discoveryCache.invalidateCurrentViewer({
        sourceType: 'community',
        communityId,
      }))
    );
  }
}
