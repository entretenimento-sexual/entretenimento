// functions/src/community/request-community-membership.handler.ts
// -----------------------------------------------------------------------------
// REQUEST COMMUNITY MEMBERSHIP
// -----------------------------------------------------------------------------
// Único comando de adesão desta fase. O cliente não escreve memberships.
// Entrada aberta ativa imediatamente; aprovação cria estado pendente.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db, FieldValue } from '../firebaseApp';
import {
  evaluatePlatformSubscriptionEntitlement,
  hasMinimumPlatformRole,
  isPlatformRole,
} from '../payments/application/platform-subscription-entitlement.service';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
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

function isAdultEligible(user: Record<string, unknown>): boolean {
  const idade = user['idade'];
  const adultConsent = (user['adultConsent'] ?? {}) as Record<string, unknown>;
  const ageReverification = (user['ageReverification'] ?? {}) as Record<
    string,
    unknown
  >;
  const ageStatus = String(ageReverification['status'] ?? '')
    .trim()
    .toUpperCase();

  if (typeof idade === 'number' && idade < 18) return false;
  if (ageReverification['result'] === 'UNDERAGE') return false;
  if (
    ['REQUIRED', 'SUBMITTED', 'UNDER_REVIEW', 'REJECTED', 'EXPIRED']
      .includes(ageStatus)
  ) {
    return false;
  }
  if (adultConsent['accepted'] === false) return false;
  if (
    user['initialAdultConsentRequired'] === true
    && adultConsent['accepted'] !== true
  ) {
    return false;
  }

  return true;
}

function assertActorEligible(rawUser: unknown, uid: string): void {
  const user = (rawUser ?? {}) as Record<string, unknown>;

  if (user['uid'] !== uid) {
    throw new HttpsError('not-found', 'Perfil não localizado.', {
      reason: 'profile_incomplete',
      recommendedAction: 'complete_profile',
    });
  }

  const accountStatus = String(user['accountStatus'] ?? 'active')
    .trim()
    .toLowerCase();
  const restricted =
    accountStatus !== 'active'
    || user['suspended'] === true
    || user['interactionBlocked'] === true
    || user['accountLocked'] === true
    || user['loginAllowed'] === false;

  if (restricted) {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não pode participar agora.',
      {
        reason: 'account_restricted',
        recommendedAction: 'review_account',
      }
    );
  }

  if (!isAdultEligible(user)) {
    throw new HttpsError(
      'failed-precondition',
      'Confirmação de acesso adulto necessária.',
      {
        reason: 'adult_access_required',
        recommendedAction: 'confirm_adult_access',
      }
    );
  }

  if (user['profileCompleted'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Complete seu perfil para continuar.',
      {
        reason: 'profile_incomplete',
        recommendedAction: 'complete_profile',
      }
    );
  }
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

        assertActorEligible(
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
        const contentAccess = (access['contentAccess'] ?? {}) as Record<
          string,
          unknown
        >;
        const join = normalizeJoin(access['join']);
        const minimumRole = isPlatformRole(contentAccess['minimumRole'])
          ? contentAccess['minimumRole']
          : 'basic';
        const requiresEntitlement =
          contentAccess['requiresActiveSubscription'] === true
          || isPlatformRole(contentAccess['minimumRole']);
        let entitlementAllowed = !requiresEntitlement;

        if (requiresEntitlement) {
          const entitlementRef = db
            .collection('entitlements')
            .doc(`platform_subscription_${uid}`);
          const entitlementSnapshot = await transaction.get(entitlementRef);
          const entitlement = evaluatePlatformSubscriptionEntitlement(
            entitlementSnapshot.exists ? entitlementSnapshot.data() : null,
            uid
          );
          entitlementAllowed =
            entitlement.active
            && hasMinimumPlatformRole(entitlement.role, minimumRole);
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
          throwDecisionError(decision.denialReason, minimumRole);
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
