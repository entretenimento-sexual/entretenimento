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
// moderação. A criação e a capacidade são revalidadas pelo entitlement canônico
// do proprietário; o plano dos participantes não restringe a adesão.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  evaluatePlatformSubscriptionEntitlement,
} from '../payments/application/platform-subscription-entitlement.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  MAX_PERSONAL_COMMUNITIES_PER_OWNER,
  isCommunityMemberLimitAllowed,
  resolveCommunityCapacitySponsorRole,
  resolveCommunityOwnerPlanLimit,
  resolvePersonalCommunityCreationPolicy,
} from './community-capacity.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import { buildCommunityRankingProjectionPatch } from './community-ranking-sync.policy';
import {
  CreateCommunityRequest,
  CreateCommunityResponse,
  normalizeCreateCommunityRequest,
} from './create-community.model';

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

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
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CreateCommunityResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
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
      const ownedCommunitiesQuery = db
        .collection('communities')
        .where('ownerUid', '==', actorUid)
        .where('source.type', '==', 'community')
        .where('status', 'in', ['active', 'paused', 'dormant'])
        .limit(MAX_PERSONAL_COMMUNITIES_PER_OWNER + 1);

      const [
        requestSnapshot,
        userSnapshot,
        entitlementSnapshot,
        communitySnapshot,
        ownedCommunitiesSnapshot,
      ] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(userRef),
        transaction.get(entitlementRef),
        transaction.get(communityRef),
        transaction.get(ownedCommunitiesQuery),
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

      const actorUser = userSnapshot.data() ?? {};
      const entitlement = evaluatePlatformSubscriptionEntitlement(
        entitlementSnapshot.exists ? entitlementSnapshot.data() : null,
        actorUid
      );
      const capacitySponsorRole = resolveCommunityCapacitySponsorRole(
        entitlement.active ? entitlement.role : null,
        actorUser['role']
      );
      const creationPolicy = resolvePersonalCommunityCreationPolicy(
        capacitySponsorRole
      );

      if (!creationPolicy.canCreate) {
        throw new HttpsError(
          'permission-denied',
          'Uma assinatura Basic ou superior é necessária para criar Comunidades.',
          {
            reason: 'community_creation_subscription_required',
            recommendedAction: 'upgrade_subscription',
            minimumRole: 'basic',
          }
        );
      }

      if (
        creationPolicy.maxOwnedCommunities !== null
        && ownedCommunitiesSnapshot.size
          >= creationPolicy.maxOwnedCommunities
      ) {
        throw new HttpsError(
          'resource-exhausted',
          'Seu plano atingiu a quantidade de Comunidades próprias.',
          {
            reason: 'community_creation_limit_reached',
            maxOwnedCommunities: creationPolicy.maxOwnedCommunities,
            currentOwnedCommunities: ownedCommunitiesSnapshot.size,
          }
        );
      }

      if (!isCommunityMemberLimitAllowed(
        command.memberLimit,
        capacitySponsorRole
      )) {
        throw new HttpsError(
          'permission-denied',
          'Seu plano atual não permite a capacidade escolhida.',
          {
            reason: 'community_capacity_upgrade_required',
            recommendedAction: 'upgrade_subscription',
            allowedMemberLimit: resolveCommunityOwnerPlanLimit(
              capacitySponsorRole
            ),
          }
        );
      }

      if (communitySnapshot.exists) {
        throw new HttpsError(
          'already-exists',
          'Não foi possível reservar o identificador desta Comunidade.'
        );
      }

      const now = Date.now();
      const metrics = {
        memberCount: 1,
        postCount: 0,
        mediaCount: 0,
        topicCount: 0,
      };
      const contentAccess = {
        requiresActiveSubscription: false,
        minimumRole: null,
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
      const lifecycle = {
        lastMeaningfulActivityAt: now,
        dormantAt: null,
        archivedAt: null,
        scheduledForDeletionAt: null,
        interactionBlocked: false,
        retentionHold: false,
        policyVersion: 1,
        updatedAt: now,
      };
      const moderation = {
        state: 'active',
        reviewedAt: now,
        reviewedBy: actorUid,
        reason: 'emulator-self-created',
      };
      const rankingPatch = buildCommunityRankingProjectionPatch(
        {
          description: command.description,
          source,
          moderation,
          metrics,
          lifecycle,
          createdAt: now,
          updatedAt: now,
        },
        { avatarUrl: null, coverUrl: null },
        now
      );
      const currentCreationRevision = Number.isSafeInteger(
        actorUser['communityCreationRevision']
      ) && Number(actorUser['communityCreationRevision']) >= 0
        ? Number(actorUser['communityCreationRevision'])
        : 0;

      // A escrita no documento já lido do proprietário serializa criações
      // concorrentes. Se duas abas tentarem criar ao mesmo tempo, uma transação
      // reinicia e reavalia a consulta de quota antes de confirmar.
      transaction.update(userRef, {
        communityCreationRevision: currentCreationRevision + 1,
        communityLastCreatedAt: now,
      });

      transaction.create(communityRef, {
        name: command.name,
        slug: command.slug,
        theme: command.theme,
        tagIds: command.tagIds,
        description: command.description,
        rules: command.rules,
        source,
        status: 'active',
        visibility: 'public_preview',
        ownerUid: actorUid,
        access,
        moderation,
        metrics,
        capacity: {
          memberLimit: command.memberLimit,
          policyVersion: 1,
        },
        lifecycle,
        createdBy: actorUid,
        createdAt: now,
        updatedAt: now,
      });

      transaction.create(discoveryRef, {
        communityId: command.communityId,
        name: command.name,
        slug: command.slug,
        tagIds: command.tagIds,
        description: command.description,
        source,
        status: 'active',
        moderationState: 'active',
        visibility: 'public_preview',
        metrics,
        capacity: {
          memberLimit: command.memberLimit,
          policyVersion: 1,
        },
        access,
        avatarUrl: null,
        coverUrl: null,
        ...rankingPatch,
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
