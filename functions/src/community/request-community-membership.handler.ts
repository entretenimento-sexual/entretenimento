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
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  assertCommunityMembershipActorEligible,
  isCommunityMembershipEntitlementAllowed,
  resolveCommunityMembershipRequirement,
} from './community-membership-eligibility.service';
import {
  CommunityJoinPolicy,
  CommunityMembershipStatus,
  evaluateCommunityMembershipRequest,
} from './community-membership-request.policy';
import { normalizeCommunityId } from './community-preview.model';

interface RequestCommunityMembershipPayload {
  communityId?: unknown;
}

interface RequestCommunityMembershipResponse {
  status: 'active' | 'pending';
  viewerMode: 'member' | 'pending';
  canInteract: boolean;
}

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

function normalizeJoin(value: unknown): CommunityJoinPolicy {
  return value === 'open' || value === 'invite_only' ? value : 'approval';
}

function normalizeMembershipStatus(
  value: unknown
): CommunityMembershipStatus | null {
  return value === 'active'
    || value === 'pending'
    || value === 'blocked'
    || value === 'left'
    ? value
    : null;
}

function throwDecisionError(
  reason: string | null,
  minimumRole: 'basic' | 'premium' | 'vip'
): never {
  if (reason === 'invite_only') {
    throw new HttpsError(
      'failed-precondition',
      'Esta comunidade aceita somente convites.'
    );
  }

  if (reason === 'membership_blocked') {
    throw new HttpsError(
      'permission-denied',
      'Você não pode participar desta comunidade.'
    );
  }

  if (reason === 'subscription_required') {
    throw new HttpsError(
      'permission-denied',
      'Assinatura compatível necessária.',
      {
        reason: 'subscription_inactive',
        recommendedAction: 'upgrade_subscription',
        minimumRole,
      }
    );
  }

  if (reason === 'actor_restricted') {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não pode participar agora.'
    );
  }

  throw new HttpsError(
    'failed-precondition',
    'Esta comunidade não aceita novas entradas agora.'
  );
}

export const requestCommunityMembership =
  onCall<RequestCommunityMembershipPayload>(
    { region: FUNCTIONS_REGION },
    async (request): Promise<RequestCommunityMembershipResponse> => {
      assertPreviewRuntime();

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
        const requirement = resolveCommunityMembershipRequirement(community);
        let entitlementAllowed = !requirement.requiresEntitlement;

        if (requirement.requiresEntitlement) {
          const entitlementRef = db
            .collection('entitlements')
            .doc(`platform_subscription_${uid}`);
          const entitlementSnapshot = await transaction.get(entitlementRef);
          entitlementAllowed = isCommunityMembershipEntitlementAllowed(
            entitlementSnapshot.exists ? entitlementSnapshot.data() : null,
            uid,
            requirement
          );
        }

        const existingStatus = normalizeMembershipStatus(
          membershipSnapshot.data()?.['status']
        );
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
          entitlementAllowed,
        });

        if (!decision.allowed || !decision.targetStatus) {
          throwDecisionError(decision.denialReason, requirement.minimumRole);
        }

        if (!decision.idempotent) {
          const now = FieldValue.serverTimestamp();
          const targetStatus = decision.targetStatus;

          transaction.set(
            membershipRef,
            {
              communityId,
              uid,
              role: 'member',
              status: targetStatus,
              requestedAt: targetStatus === 'pending' ? now : null,
              joinedAt: targetStatus === 'active' ? now : null,
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

          if (decision.incrementMemberCount) {
            transaction.update(communityRef, {
              'metrics.memberCount': FieldValue.increment(1),
              updatedAt: now,
            });

            if (discoverySnapshot.exists) {
              transaction.update(discoveryRef, {
                'metrics.memberCount': FieldValue.increment(1),
                updatedAt: now,
              });
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
