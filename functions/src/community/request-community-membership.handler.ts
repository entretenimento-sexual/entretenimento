// functions/src/community/request-community-membership.handler.ts
// -----------------------------------------------------------------------------
// REQUEST COMMUNITY MEMBERSHIP
// -----------------------------------------------------------------------------
// Comando de adesão desta fase. O cliente não escreve memberships.
// Entrada aberta ativa imediatamente; aprovação cria estado pendente.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import { resolveCommunityCanonicalOwnerUid } from './community-canonical-owner.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  assertCommunityAcceptingNewMembers,
  getCommunityCapacityForOwnerInTransaction,
} from './community-capacity.service';
import { resolveCommunityMemberCountDelta } from './community-member-count.policy';
import {
  assertCommunityMembershipActorEligible,
} from './community-membership-eligibility.service';
import {
  CommunityJoinPolicy,
  evaluateCommunityMembershipRequest,
} from './community-membership-request.policy';
import {
  classifyExistingCommunityMembershipState,
} from './community-membership-state.policy';
import {
  buildCommunityMembershipRequestNotificationCopy,
  buildCommunityMembershipRequestNotificationId,
  buildCommunityNotificationRoute,
  canReceiveCommunityEssentialNotification,
  type CommunityNotificationUser,
} from './community-notification.policy';
import { normalizeCommunityId } from './community-preview.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import { syncCommunityUserIndexInTransaction } from './community-user-index.transaction';

interface RequestCommunityMembershipPayload {
  communityId?: unknown;
}

interface RequestCommunityMembershipResponse {
  status: 'active' | 'pending';
  viewerMode: 'member' | 'pending';
  canInteract: boolean;
}

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

function normalizeJoin(value: unknown): CommunityJoinPolicy | null {
  return value === 'open'
    || value === 'approval'
    || value === 'invite_only'
    ? value
    : null;
}

function resolveMemberCountDelta(
  rawCommunity: unknown,
  delta: -1 | 1
): number | null {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;

  return resolveCommunityMemberCountDelta(metrics['memberCount'], delta);
}

function throwDecisionError(reason: string | null): never {
  if (reason === 'join_policy_invalid') {
    throw new HttpsError(
      'data-loss',
      'A política de entrada desta Comunidade está inconsistente.',
      { reason: 'join_policy_invalid' }
    );
  }

  if (reason === 'invite_only') {
    throw new HttpsError(
      'failed-precondition',
      'Esta comunidade aceita somente convites.',
      { reason: 'invite_only' }
    );
  }

  if (reason === 'membership_blocked') {
    throw new HttpsError(
      'permission-denied',
      'Você não pode participar desta comunidade.',
      { reason: 'membership_blocked' }
    );
  }

  if (reason === 'actor_restricted') {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não pode participar agora.',
      { reason: 'actor_restricted' }
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'Esta comunidade não aceita novas entradas agora.',
    { reason: 'community_unavailable' }
  );
}

export const requestCommunityMembership =
  onCall<RequestCommunityMembershipPayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<RequestCommunityMembershipResponse> => {
      assertPreviewRuntime();
      assertCommunityCallableAppCheck(request.app);

      const uid = String(request.auth?.uid ?? '').trim();
      if (!uid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      if (request.auth?.token.email_verified !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Verifique seu e-mail para continuar.'
        );
      }

      const communityId = normalizeCommunityId(request.data?.communityId);
      if (!communityId) {
        throw new HttpsError('invalid-argument', 'Comunidade inválida.');
      }

      await consumeCommunityRateLimit({
        action: 'membership_request',
        actorUid: uid,
      });

      const requestCycleStartedAtMs = Date.now();

      return db.runTransaction(async (transaction) => {
        const communityRef = db.collection('communities').doc(communityId);
        const discoveryRef = db
          .collection('community_discovery_index')
          .doc(communityId);
        const membershipRef = communityRef.collection('members').doc(uid);
        const userRef = db.collection('users').doc(uid);
        const auditRef = db.collection('community_membership_audit').doc();

        const [
          communitySnapshot,
          discoverySnapshot,
          membershipSnapshot,
          userSnapshot,
        ] = await Promise.all([
          transaction.get(communityRef),
          transaction.get(discoveryRef),
          transaction.get(membershipRef),
          transaction.get(userRef),
        ]);

        if (!communitySnapshot.exists) {
          throw new HttpsError('not-found', 'Comunidade não encontrada.');
        }

        assertCommunityMembershipActorEligible(
          userSnapshot.exists ? userSnapshot.data() : null,
          uid
        );

        const community = (communitySnapshot.data() ?? {}) as Record<
          string,
          unknown
        >;
        const moderation = (community['moderation'] ?? {}) as Record<
          string,
          unknown
        >;
        const access = (community['access'] ?? {}) as Record<string, unknown>;
        const join = normalizeJoin(access['join']);
        const membershipState = classifyExistingCommunityMembershipState(
          membershipSnapshot.exists,
          membershipSnapshot.data()?.['status']
        );

        if (membershipState.kind === 'invalid') {
          throw new HttpsError(
            'failed-precondition',
            'Seu vínculo com esta comunidade precisa ser regularizado.',
            { reason: 'membership_status_invalid' }
          );
        }

        const existingStatus = membershipState.kind === 'valid'
          ? membershipState.status
          : null;
        const existingJoinedAt = membershipSnapshot.exists
          ? membershipSnapshot.data()?.['joinedAt'] ?? null
          : null;
        const operational =
          community['status'] === 'active'
          && moderation['state'] === 'active';
        const publicPreview =
          community['visibility'] === 'public_preview'
          && access['preview'] === 'authenticated';
        const decision = evaluateCommunityMembershipRequest({
          operational,
          publicPreview,
          join,
          existingStatus,
          actorEligible: true,
        });

        if (!decision.allowed || !decision.targetStatus) {
          throwDecisionError(decision.denialReason);
        }

        if (decision.incrementMemberCount) {
          const capacity = await getCommunityCapacityForOwnerInTransaction(
            transaction,
            community
          );
          assertCommunityAcceptingNewMembers(capacity);
        }

        const targetStatus = decision.targetStatus;
        const ownerUid = targetStatus === 'pending'
          ? resolveCommunityCanonicalOwnerUid(community)
          : null;
        const ownerUserSnapshot = ownerUid && ownerUid !== uid
          ? await transaction.get(db.collection('users').doc(ownerUid))
          : null;

        if (!decision.idempotent) {
          const nextMemberCount = decision.incrementMemberCount
            ? resolveMemberCountDelta(community, 1)
            : null;

          if (decision.incrementMemberCount && nextMemberCount === null) {
            throw new HttpsError(
              'data-loss',
              'A contagem de participantes desta Comunidade está inconsistente.'
            );
          }

          const now = FieldValue.serverTimestamp();

          transaction.set(
            membershipRef,
            {
              communityId,
              uid,
              role: 'member',
              status: targetStatus,
              requestedAt: targetStatus === 'pending' ? now : null,
              joinedAt: targetStatus === 'active' ? now : existingJoinedAt,
              leftAt: null,
              reviewedAt: null,
              reviewedBy: null,
              requestResolution: null,
              updatedAt: now,
              policyVersion: 1,
              source: 'callable',
            },
            { merge: true }
          );

          syncCommunityUserIndexInTransaction({
            transaction,
            communityId,
            memberId: uid,
            community,
            membership: {
              role: 'member',
              status: targetStatus,
            },
            updatedAt: now,
          });

          if (decision.incrementMemberCount) {
            transaction.update(communityRef, {
              'metrics.memberCount': nextMemberCount,
              updatedAt: now,
            });

            if (discoverySnapshot.exists) {
              transaction.update(discoveryRef, {
                'metrics.memberCount': nextMemberCount,
                updatedAt: now,
              });
            }
          }

          if (
            targetStatus === 'pending'
            && ownerUid
            && ownerUserSnapshot?.exists
          ) {
            const ownerUser = ownerUserSnapshot.data() as
              | CommunityNotificationUser
              | undefined;

            if (canReceiveCommunityEssentialNotification(
              ownerUser,
              ownerUid,
              uid
            )) {
              const notificationRef = db
                .collection('notifications')
                .doc(buildCommunityMembershipRequestNotificationId(
                  communityId,
                  uid,
                  requestCycleStartedAtMs
                ));
              const copy = buildCommunityMembershipRequestNotificationCopy({
                communityName: community['name'],
              });

              transaction.set(notificationRef, {
                userId: ownerUid,
                type: 'community.membership.requested',
                title: copy.title,
                body: copy.body,
                route: `${buildCommunityNotificationRoute(communityId)}?secao=gestao`,
                communityId,
                actorUid: uid,
                actionRequired: true,
                readAt: null,
                createdAt: now,
                updatedAt: now,
              }, { merge: true });
            }
          }

          transaction.set(auditRef, {
            action: targetStatus === 'active'
              ? 'community-membership-joined'
              : 'community-membership-requested',
            communityId,
            actorUid: uid,
            subjectUid: uid,
            status: targetStatus,
            createdAt: now,
            source: 'callable',
          });
        }

        return {
          status: decision.targetStatus,
          viewerMode: decision.targetStatus === 'active'
            ? 'member'
            : 'pending',
          canInteract: decision.targetStatus === 'active' && operational,
        };
      });
    }
  );
