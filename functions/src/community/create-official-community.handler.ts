// functions/src/community/create-official-community.handler.ts
// -----------------------------------------------------------------------------
// CREATE OFFICIAL COMMUNITY
// -----------------------------------------------------------------------------
// Cria uma Comunidade nova já vinculada a um alvo oficial EXISTENTE:
// Perfil, Organização, Local ou Evento.
//
// Fronteiras:
// - autoridade real: fontes canônicas backend-only;
// - assinatura pessoal: não participa deste fluxo;
// - role comunitária: owner apenas governa a Comunidade criada;
// - role de autoridade: self/representante/manager/organizer/... fica somente
//   na associação/claim oficial e nunca é inferida do membership.
//
// createVenueCommunity continua sendo o fluxo composto que cria um Local novo.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  resolveOfficialCommunityCreationEntitlementInTransaction,
} from './community-official-creation-entitlement.service';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  buildCommunityOperationalRequestRetention,
} from './community-operational-retention.policy';
import {
  buildVerifiedCommunityOfficialAssociation,
  sanitizeCommunityOfficialAssociationPublicProjection,
} from './community-official-association.model';
import {
  resolveCommunityOfficialAuthorityContext,
} from './community-official-authority-context.service';
import {
  COMMUNITY_OFFICIAL_CLAIM_POLICY_VERSION,
  type CommunityOfficialClaimRecord,
  type SubmitCommunityOfficialClaimIntentCommand,
} from './community-official-claim.model';
import {
  assertCommunityMembershipActorEligible,
} from './community-membership-eligibility.service';
import {
  assertCommunitySocialAccessForUid,
} from './community-social-access.service';
import {
  normalizeCommunityPublicLocation,
} from './community-public-location.model';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import {
  buildCommunityRankingProjectionPatch,
} from './community-ranking-sync.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  type CreateOfficialCommunityRequest,
  type CreateOfficialCommunityResponse,
  normalizeCreateOfficialCommunityRequest,
} from './create-official-community.model';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeCreatedAt(value: unknown, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= fallback
    ? parsed
    : fallback;
}

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A criação de Comunidades Oficiais ainda não está disponível neste ambiente.'
  );
}

function assertAuthenticatedUid(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = cleanId(auth?.uid);
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

export const createOfficialCommunity = onCall<CreateOfficialCommunityRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CreateOfficialCommunityResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);

    const actorUid = assertAuthenticatedUid(request.auth);
    assertRecentAuthentication(request.auth?.token);
    await assertCommunitySocialAccessForUid(actorUid);

    const command = normalizeCreateOfficialCommunityRequest(request.data);
    if (!command) {
      throw new HttpsError(
        'invalid-argument',
        'Revise a Comunidade, o alvo oficial e a declaração de autorização.'
      );
    }

    await consumeCommunityRateLimit({
      action: 'official_community_create',
      actorUid,
    });

    return db.runTransaction(async (transaction) => {
      const requestRef = db
        .collection('official_community_creation_requests')
        .doc(`${actorUid}:${command.requestId}`);
      const communityRef = db.collection('communities').doc(command.communityId);
      const associationRef = db
        .collection('community_official_associations')
        .doc(command.associationKey);
      const claimRef = db
        .collection('community_official_claims')
        .doc(command.associationKey);
      const userRef = db.collection('users').doc(actorUid);
      const ownerMembershipRef = communityRef.collection('members').doc(actorUid);
      const discoveryRef = db
        .collection('community_discovery_index')
        .doc(command.communityId);
      const userIndexRef = db
        .collection('community_user_index')
        .doc(actorUid)
        .collection('items')
        .doc(command.communityId);
      const entitlementUsageAuditRef = db
        .collection('business_official_entitlement_usage_audit')
        .doc(`official-create-${command.requestId}`);

      const [
        requestSnapshot,
        communitySnapshot,
        associationSnapshot,
        claimSnapshot,
        userSnapshot,
      ] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(communityRef),
        transaction.get(associationRef),
        transaction.get(claimRef),
        transaction.get(userRef),
      ]);

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        if (
          cleanId(existing['actorUid']) !== actorUid
          || cleanId(existing['communityId']) !== command.communityId
          || existing['associationKey'] !== command.associationKey
        ) {
          throw new HttpsError(
            'already-exists',
            'O identificador desta solicitação já foi utilizado.'
          );
        }

        return {
          communityId: command.communityId,
          associationKey: command.associationKey,
          target: command.target,
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

      const existingAssociation = associationSnapshot.exists
        ? associationSnapshot.data() ?? {}
        : null;
      if (existingAssociation?.['status'] === 'verified') {
        throw new HttpsError(
          'already-exists',
          'Este alvo já possui uma Comunidade Oficial ativa.',
          { reason: 'official_target_already_associated' }
        );
      }

      const now = Date.now();
      const intent: SubmitCommunityOfficialClaimIntentCommand = {
        requestId: command.requestId,
        communityId: command.communityId,
        target: command.target,
        associationKey: command.associationKey,
        declarationAccepted: true,
      };
      const derived = await resolveCommunityOfficialAuthorityContext({
        transaction,
        actorUid,
        intent,
        now,
      });

      if (!derived.command || !derived.verification) {
        throw new HttpsError(
          'failed-precondition',
          'Não foi possível comprovar a autoridade necessária para criar esta Comunidade Oficial.',
          {
            reason:
              `official_creation_${derived.denialReason ?? 'unsupported_target'}`,
          }
        );
      }

      const authority = derived.command;
      const verification = derived.verification;
      const officialCapability =
        await resolveOfficialCommunityCreationEntitlementInTransaction({
          transaction,
          actorUid,
          sponsorOrganizationId: authority.sponsorOrganizationId,
          now,
        });
      const grantedMemberLimit = officialCapability.memberLimit;
      const capabilitySubjectType = officialCapability.subjectType;
      const capabilitySubjectId = officialCapability.subjectId;

      if (
        !officialCapability.allowed
        || !officialCapability.entitlementId
        || !capabilitySubjectType
        || !capabilitySubjectId
        || grantedMemberLimit === null
      ) {
        const reason = officialCapability.denialReason === 'entitlement_inactive'
          ? 'official_creation_entitlement_inactive'
          : officialCapability.denialReason === 'entitlement_mismatch'
            ? 'official_creation_entitlement_mismatch'
            : 'official_creation_entitlement_required';
        throw new HttpsError(
          'permission-denied',
          'A capacidade comercial desta Comunidade Oficial não está disponível.',
          { reason }
        );
      }

      if (officialCapability.maxOfficialCommunities !== null) {
        const officialAssociations = db.collection(
          'community_official_associations'
        );
        const quotaSubjectQuery = capabilitySubjectType === 'organization'
          ? officialAssociations.where(
            'sponsorOrganizationId',
            '==',
            capabilitySubjectId
          )
          : officialAssociations
            .where('sponsorOrganizationId', '==', null)
            .where(
              'authority.holderUid',
              '==',
              capabilitySubjectId
            );
        const quotaQuery = quotaSubjectQuery
          .where('status', '==', 'verified')
          .limit(officialCapability.maxOfficialCommunities + 1);
        const quotaSnapshot = await transaction.get(quotaQuery);

        if (
          quotaSnapshot.size
          >= officialCapability.maxOfficialCommunities
        ) {
          throw new HttpsError(
            'resource-exhausted',
            'A capacidade contratada de Comunidades Oficiais foi atingida.',
            {
              reason: 'official_creation_limit_reached',
              maxOfficialCommunities:
                officialCapability.maxOfficialCommunities,
              currentOfficialCommunities: quotaSnapshot.size,
            }
          );
        }
      }

      const associationCreatedAt = existingAssociation
        ? normalizeCreatedAt(existingAssociation['createdAt'], now)
        : now;
      const officialAssociation = buildVerifiedCommunityOfficialAssociation({
        target: command.target,
        communityId: command.communityId,
        sponsorOrganizationId: authority.sponsorOrganizationId,
        holderUid: actorUid,
        authorityRole: authority.authorityRole,
        verificationSource: verification.verificationSource,
        verifiedAt: now,
        verificationPolicyVersion: verification.verificationPolicyVersion,
        revalidationDueAt: verification.revalidationDueAt,
        verificationExpiresAt: verification.verificationExpiresAt,
        createdAt: associationCreatedAt,
      });
      const publicAssociation =
        sanitizeCommunityOfficialAssociationPublicProjection(
          officialAssociation
        );

      if (!officialAssociation || !publicAssociation) {
        throw new HttpsError(
          'data-loss',
          'A associação oficial não pôde ser construída com segurança.'
        );
      }

      let publicLocation = null;
      if (command.target.type === 'venue') {
        const venueRef = db.collection('venues').doc(command.target.id);
        const venueSnapshot = await transaction.get(venueRef);
        if (!venueSnapshot.exists) {
          throw new HttpsError('not-found', 'O Local oficial não foi encontrado.');
        }
        publicLocation = normalizeCommunityPublicLocation(
          venueSnapshot.data()?.['region']
        );
        transaction.update(venueRef, {
          officialAssociationKey: command.associationKey,
          updatedAt: now,
        });
      }

      const existingClaim = claimSnapshot.exists ? claimSnapshot.data() ?? {} : null;
      const submissionAttempt = existingClaim
        ? normalizePositiveInteger(existingClaim['submissionAttempt'], 0) + 1
        : 1;
      const claimCreatedAt = existingClaim
        ? normalizeCreatedAt(existingClaim['createdAt'], now)
        : now;
      const claim: CommunityOfficialClaimRecord = {
        claimId: command.associationKey,
        associationKey: command.associationKey,
        communityId: command.communityId,
        target: command.target,
        claimantUid: actorUid,
        authorityRole: authority.authorityRole,
        sponsorOrganizationId: authority.sponsorOrganizationId,
        evidenceReferences: authority.evidenceReferences,
        status: 'verified',
        policyVersion: COMMUNITY_OFFICIAL_CLAIM_POLICY_VERSION,
        submissionAttempt,
        submittedAt: now,
        declarationAccepted: true,
        declarationAcceptedAt: now,
        revalidationRequestedAt: null,
        reviewedAt: now,
        reviewedBy: 'system',
        reviewResolution:
          'Vínculo oficial comprovado automaticamente no ato da criação.',
        verificationExpiresAt: verification.verificationExpiresAt,
        revalidationDueAt: verification.revalidationDueAt,
        createdAt: claimCreatedAt,
        updatedAt: now,
      };

      const source = command.target.type === 'venue'
        ? { type: 'venue' as const, id: command.target.id }
        : { type: 'community' as const, id: command.communityId };
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
        reason: 'canonical-official-creation',
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
        officialAssociationKey: command.associationKey,
        access,
        moderation,
        metrics,
        capacity: {
          memberLimit: grantedMemberLimit,
          sponsorType: 'official',
          entitlementCapability: 'officialCommunityCreation',
          policyVersion: 1,
        },
        lifecycle,
        createdBy: actorUid,
        ...(publicLocation ? { publicLocation } : {}),
        createdAt: now,
        updatedAt: now,
      });

      transaction.set(associationRef, officialAssociation);
      transaction.set(claimRef, claim);

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
          memberLimit: grantedMemberLimit,
          sponsorType: 'official',
          policyVersion: 1,
        },
        access,
        officialAssociation: publicAssociation,
        avatarUrl: null,
        coverUrl: null,
        ...(publicLocation ? { publicLocation } : {}),
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
        source: 'official-community-create',
      });

      transaction.create(userIndexRef, {
        communityId: command.communityId,
        name: command.name,
        source,
        role: 'owner',
        status: 'active',
        updatedAt: now,
      });

      transaction.create(
        db.collection('community_membership_audit')
          .doc(`official-create-${command.requestId}`),
        {
          action: 'official_community_created',
          communityId: command.communityId,
          actorUid,
          subjectUid: actorUid,
          target: command.target,
          previousStatus: null,
          nextStatus: 'active',
          previousRole: null,
          nextRole: 'owner',
          createdAt: now,
        }
      );

      transaction.create(
        db.collection('community_official_association_audit')
          .doc(`official-create-${command.requestId}`),
        {
          action: 'official_association_verified',
          associationKey: command.associationKey,
          communityId: command.communityId,
          target: command.target,
          actorUid,
          sponsorOrganizationId: authority.sponsorOrganizationId,
          authorityRole: authority.authorityRole,
          verificationSource: verification.verificationSource,
          verificationPolicyVersion: verification.verificationPolicyVersion,
          previousStatus: existingAssociation?.['status'] ?? null,
          nextStatus: 'verified',
          createdAt: now,
        }
      );

      transaction.create(entitlementUsageAuditRef, {
        action: 'business_official_entitlement_consumed',
        entitlementId: officialCapability.entitlementId,
        entitlementPolicyVersion: officialCapability.policyVersion,
        capability: 'officialCommunityCreation',
        subjectType: officialCapability.subjectType,
        subjectId: officialCapability.subjectId,
        communityId: command.communityId,
        target: command.target,
        grantedMemberLimit,
        maxOfficialCommunities: officialCapability.maxOfficialCommunities,
        actorUid,
        createdAt: now,
      });

      transaction.create(
        db.collection('community_official_claim_audit').doc(),
        {
          action: 'official_claim_auto_verified_on_creation',
          associationKey: command.associationKey,
          communityId: command.communityId,
          target: command.target,
          claimantUid: actorUid,
          authorityRole: authority.authorityRole,
          sponsorOrganizationId: authority.sponsorOrganizationId,
          evidenceReferenceCount: authority.evidenceReferences.length,
          declarationAccepted: true,
          declarationAcceptedAt: now,
          verificationSource: verification.verificationSource,
          verificationPolicyVersion: verification.verificationPolicyVersion,
          verificationExpiresAt: verification.verificationExpiresAt,
          revalidationDueAt: verification.revalidationDueAt,
          submissionAttempt,
          policyVersion: COMMUNITY_OFFICIAL_CLAIM_POLICY_VERSION,
          previousStatus: existingClaim?.['status'] ?? null,
          nextStatus: 'verified',
          actorUid: 'system',
          createdAt: now,
        }
      );

      transaction.create(requestRef, {
        ...buildCommunityOperationalRequestRetention('official_creation', now),
        actorUid,
        associationKey: command.associationKey,
        communityId: command.communityId,
        target: command.target,
        declarationAccepted: true,
        declarationAcceptedAt: now,
        status: 'verified',
        capacityEntitlementId: officialCapability.entitlementId,
        capacityEntitlementPolicyVersion: officialCapability.policyVersion,
        grantedMemberLimit,
        maxOfficialCommunities: officialCapability.maxOfficialCommunities,
        createdAt: now,
        updatedAt: now,
      });

      return {
        communityId: command.communityId,
        associationKey: command.associationKey,
        target: command.target,
        created: true,
      };
    });
  }
);
