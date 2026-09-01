// src/app/community/data-access/community-invite.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable, tap } from 'rxjs';

import { CommunityDiscoveryCacheService } from '../discovery/community-discovery-cache.service';
import {
  CommunityInviteInbox,
  CommunityInviteCandidateResponse,
  CommunityInviteResult,
  CommunitySentInvitesResponse,
  normalizeCommunityInviteCandidateResponse,
  normalizeCommunityInviteInbox,
  normalizeCommunityInviteResult,
  normalizeCommunitySentInvitesResponse,
} from './community-invite.model';

@Injectable({ providedIn: 'root' })
export class CommunityInviteRepository {
  private readonly functions = inject(Functions);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);

  private readonly getInvitesCallable = httpsCallable<void, unknown>(
    this.functions,
    'getCommunityInvites'
  );

  private readonly acceptInviteCallable = httpsCallable<
    { inviteId: string },
    unknown
  >(this.functions, 'acceptCommunityInvite');

  private readonly declineInviteCallable = httpsCallable<
    { inviteId: string },
    unknown
  >(this.functions, 'declineCommunityInvite');

  private readonly sendInviteCallable = httpsCallable<
    { communityId: string; receiverId: string },
    unknown
  >(this.functions, 'sendCommunityInvite');

  private readonly revokeInviteCallable = httpsCallable<
    { inviteId: string },
    unknown
  >(this.functions, 'revokeCommunityInvite');

  private readonly findCandidateCallable = httpsCallable<
    { communityId: string; nickname: string },
    unknown
  >(this.functions, 'findCommunityInviteCandidate');

  private readonly getSentInvitesCallable = httpsCallable<
    { communityId: string },
    unknown
  >(this.functions, 'getCommunitySentInvites');

  getInvites$(): Observable<CommunityInviteInbox> {
    return defer(() => from(this.getInvitesCallable())).pipe(
      map((result) => {
        const normalized = normalizeCommunityInviteInbox(result.data);

        if (!normalized) {
          throw new Error('Caixa de convites comunitários inválida.');
        }

        return normalized;
      })
    );
  }

  acceptInvite$(inviteId: string): Observable<CommunityInviteResult> {
    return this.respond$(this.acceptInviteCallable, inviteId, 'accepted').pipe(
      tap(() => this.discoveryCache.invalidateCurrentViewer({
        sourceType: 'community',
      }))
    );
  }

  declineInvite$(inviteId: string): Observable<CommunityInviteResult> {
    return this.respond$(this.declineInviteCallable, inviteId, 'declined');
  }

  sendInvite$(
    communityId: string,
    receiverId: string
  ): Observable<CommunityInviteResult> {
    return defer(() =>
      from(
        this.sendInviteCallable({
          communityId: communityId.trim(),
          receiverId: receiverId.trim(),
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityInviteResult(result.data);

        if (!normalized || normalized.status !== 'pending') {
          throw new Error('Resposta de envio de convite comunitário inválida.');
        }

        return normalized;
      })
    );
  }

  revokeInvite$(inviteId: string): Observable<CommunityInviteResult> {
    return this.respond$(this.revokeInviteCallable, inviteId, 'revoked');
  }

  findCandidate$(
    communityId: string,
    nickname: string
  ): Observable<CommunityInviteCandidateResponse> {
    return defer(() => from(this.findCandidateCallable({
      communityId: communityId.trim(),
      nickname: nickname.trim(),
    }))).pipe(
      map((result) => {
        const normalized = normalizeCommunityInviteCandidateResponse(
          result.data
        );

        if (!normalized) {
          throw new Error('Resposta de busca para convite inválida.');
        }

        return normalized;
      })
    );
  }

  getSentInvites$(
    communityId: string
  ): Observable<CommunitySentInvitesResponse> {
    return defer(() => from(this.getSentInvitesCallable({
      communityId: communityId.trim(),
    }))).pipe(
      map((result) => {
        const normalized = normalizeCommunitySentInvitesResponse(result.data);

        if (!normalized) {
          throw new Error('Resposta de convites enviados inválida.');
        }

        return normalized;
      })
    );
  }

  private respond$(
    callable: ReturnType<typeof httpsCallable<{ inviteId: string }, unknown>>,
    inviteId: string,
    expectedStatus: 'accepted' | 'declined' | 'revoked'
  ): Observable<CommunityInviteResult> {
    return defer(() => from(callable({ inviteId: inviteId.trim() }))).pipe(
      map((result) => {
        const normalized = normalizeCommunityInviteResult(result.data);

        if (!normalized || normalized.status !== expectedStatus) {
          throw new Error('Resposta de convite comunitário inválida.');
        }

        return normalized;
      })
    );
  }
}
