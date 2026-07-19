// functions/src/community/create-community.handler.ts
// -----------------------------------------------------------------------------
// CREATE COMMUNITY
// -----------------------------------------------------------------------------
// Cria de forma transacional e idempotente:
// - a Comunidade;
// - a projeção sanitizada de descoberta;
// - o vínculo do criador como owner;
// - o índice privado do usuário;
// - a auditoria e o registro da solicitação.
//
// O navegador nunca escolhe ownerUid, communityId, métricas ou estado de
// moderação. Restrições Premium/VIP são revalidadas pelo entitlement canônico.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  evaluatePlatformSubscriptionEntitlement,
  hasMinimumPlatformRole,
} from '../payments/application/platform-subscription-entitlement.service';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import {
  CreateCommunityRequest,
  CreateCommunityResponse,
  normalizeCreateCommunityRequest,
} from './create-community.model';

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'A criação de comunidades ainda não está disponível neste ambiente.'
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.'
    );
  }

  return uid;
}

function normalizeExistingId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(normalized) ? normalized : null;
}

export const createCommunity = onCall<CreateCommunityRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CreateCommunityResponse> => {
    assertPreviewRuntime();
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCreateCommunityRequest(request.data);

    if (!command) {
      throw new HttpsError(
        'invalid-argument',
        'Revise os dados obrigatórios da Comunidade.'
      );
    }

    return db.runTransaction(async (transaction) => {
      const requestRef = db
        .collection('community_creation_requests')
        .doc(command.requestId);
      const communityRef = db.collection('communities').doc(command.communityId);
      const ownerMembershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const entitlementRef = db
        .collection('entitlements')
        .doc(`platform_subscription_${actorUid}`);
      const discoveryRef = db
        .collection('community_discovery_index')
        .doc(command.communityId);
      const userIndexRef = db
        .collection('community_user_index')
        .doc(actorUid)
        .collection('items')
        .doc(command.communityId);
      const auditRef = db
        .collection('community_membership_audit')
        .doc(`community-create-${command.requestId}`);

      const [
        requestSnapshot,
        userSnapshot,
        entitlementSnapshot,
        communitySnapshot,
      ] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(userRef),
        transaction.get(entitlementRef),
        transaction.get(communityRef),
      ]);

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        const existingActorUid = String(existing['actorUid'] ?? '').trim();
        const existingCommunityId = normalizeExistingId(existing['communityId']);

        if (existingActorUid !== actorUid) {
          throw new HttpsError(
            'permission-denied',
            'Esta solicitação de criação pertence a outro usuário.'
          );
        }

        if (!existingCommunityId) {
          throw new HttpsError(
            'data-loss',
            'O registro idempotente da criação está inconsistente.'
          );
        }

        return {
          communityId: existingCommunityId,
          created: false,
        };
      }

      assertCommunityMembershipActorEligible(
        userSnapshot.exists ? userSnapshot.data() : null,
        actorUid
      );

      if (communitySnapshot.exists) {
        throw new HttpsError(
          'already-exists',
          'Não foi possível reservar o identificador desta Comunidade.'
        );
      }

      if (command.accessTier !== 'all') {
        const entitlement = evaluatePlatformSubscriptionEntitlement(
          entitlementSnapshot.exists ? entitlementSnapshot.data() : null,
          actorUid
        );

        if (
          !entitlement.active
          || !hasMinimumPlatformRole(entitlement.role, command.accessTier)
        ) {
          throw new HttpsError(
            'permission-denied',
            `Seu plano atual não permite criar uma Comunidade ${command.accessTier === 'vip' ? 'VIP' : 'Premium'}.`,
            {
              reason: 'subscription_inactive',
              recommendedAction: 'upgrade_subscription',
              minimumRole: command.accessTier,
            }
          );
        }
      }

      const now = Date.now();
      const metrics = {
        memberCount: 1,
        postCount: 0,
        mediaCount: 0,
      };
      const contentAccess = command.accessTier === 'all'
        ? {
            requiresActiveSubscription: false,
            minimumRole: null,
          }
        : {
            requiresActiveSubscription: true,
            minimumRole: command.accessTier,
          };
      const access = {
        preview: 'authenticated',
        interaction: 'members_only',
        join: command.joinPolicy,
        contentAccess,
      };
      const source = {
        type: 'community',
        id: command.communityId,
      };

      transaction.create(communityRef, {
        name: command.name,
        slug: command.slug,
        theme: command.theme,
        description: command.description,
        rules: command.rules,
        source,
        status: 'active',
        visibility: 'public_preview',
        access,
        moderation: {
          state: 'active',
          reviewedAt: now,
          reviewedBy: actorUid,
          reason: 'emulator-self-created',
        },
        metrics,
        createdBy: actorUid,
        createdAt: now,
        updatedAt: now,
      });

      transaction.create(discoveryRef, {
        communityId: command.communityId,
        name: command.name,
        slug: command.slug,
        description: command.description,
        source,
        status: 'active',
        moderationState: 'active',
        visibility: 'public_preview',
        metrics,
        access,
        avatarUrl: null,
        coverUrl: null,
        rankScore: now,
        updatedAt: now,
      });

      transaction.create(ownerMembershipRef, {
        communityId: command.communityId,
        uid: actorUid,
        role: 'owner',
        status: 'active',
        requestedAt: null,
        joinedAt: now,
        leftAt: null,
        reviewedAt: now,
        reviewedBy: actorUid,
        requestResolution: 'owner_created',
        updatedAt: now,
        policyVersion: 1,
        source: 'community-create',
      });

      transaction.create(userIndexRef, {
        communityId: command.communityId,
        name: command.name,
        source,
        role: 'owner',
        status: 'active',
        updatedAt: now,
      });

      transaction.create(auditRef, {
        action: 'community_created',
        communityId: command.communityId,
        actorUid,
        subjectUid: actorUid,
        previousStatus: null,
        nextStatus: 'active',
        previousRole: null,
        nextRole: 'owner',
        createdAt: now,
      });

      transaction.create(requestRef, {
        actorUid,
        communityId: command.communityId,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      });

      return {
        communityId: command.communityId,
        created: true,
      };
    });
  }
);
