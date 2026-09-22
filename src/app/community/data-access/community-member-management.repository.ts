// src/app/community/data-access/community-member-management.repository.ts
import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, Observable, tap } from 'rxjs';

import { CommunityDiscoveryCacheService } from '../discovery/community-discovery-cache.service';
import { resolveCommunityMemberManagementDiscoveryInvalidation } from '../discovery/community-discovery-cache-invalidation.policy';
import {
  CommunityAssignableMemberRole,
  CommunityManagedMembersPage,
  CommunityManagedMembersPageRequest,
  CommunityManageMemberResponse,
  CommunityMemberManagementAction,
  normalizeCommunityManagedMembersPage,
  normalizeCommunityManageMemberResponse,
} from './community-member-management.model';

@Injectable({ providedIn: 'root' })
export class CommunityMemberManagementRepository {
  private readonly functions = inject(Functions);
  private readonly discoveryCache = inject(CommunityDiscoveryCacheService);

  private readonly getMembersPageCallable = httpsCallable<
    {
      communityId: string;
      status: 'active' | 'blocked';
      cursor: string | null;
      limit: number;
    },
    unknown
  >(this.functions, 'getCommunityMembersForManagement');

  private readonly manageMemberCallable = httpsCallable<
    {
      communityId: string;
      memberId: string;
      action: CommunityMemberManagementAction;
      nextRole: CommunityAssignableMemberRole | null;
    },
    unknown
  >(this.functions, 'manageCommunityMember');

  getManagedMembersPage$(
    request: CommunityManagedMembersPageRequest
  ): Observable<CommunityManagedMembersPage> {
    return defer(() =>
      from(
        this.getMembersPageCallable({
          communityId: request.communityId.trim(),
          status: request.status,
          cursor: request.cursor?.trim() || null,
          limit: request.limit ?? 20,
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityManagedMembersPage(result.data);
        if (!normalized) {
          throw new Error('Lista administrativa de participantes inválida.');
        }
        return normalized;
      })
    );
  }

  manageMember$(
    communityId: string,
    memberId: string,
    action: CommunityMemberManagementAction,
    nextRole: CommunityAssignableMemberRole | null = null
  ): Observable<CommunityManageMemberResponse> {
    const normalizedCommunityId = communityId.trim();

    return defer(() =>
      from(
        this.manageMemberCallable({
          communityId: normalizedCommunityId,
          memberId: memberId.trim(),
          action,
          nextRole,
        })
      )
    ).pipe(
      map((result) => {
        const normalized = normalizeCommunityManageMemberResponse(result.data);
        if (!normalized) {
          throw new Error('Resposta de gestão de participante inválida.');
        }
        return normalized;
      }),
      tap(() => {
        const invalidation = resolveCommunityMemberManagementDiscoveryInvalidation(
          action,
          normalizedCommunityId
        );
        if (invalidation) {
          this.discoveryCache.invalidateCurrentViewer(invalidation);
        }
      })
    );
  }
}
