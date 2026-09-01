// functions/src/community/create-venue-community.handler.ts
// -----------------------------------------------------------------------------
// CREATE VENUE COMMUNITY
// -----------------------------------------------------------------------------
// Cria, em uma única transação idempotente:
// - o Local;
// - a comunidade social vinculada;
// - a associação oficial canônica;
// - a projeção de descoberta;
// - o membership do criador como owner;
// - os índices privados e trilhas de auditoria.
//
// Nesta etapa o fluxo permanece restrito ao Functions Emulator, assim como a
// experiência comunitária já existente. O cliente nunca escolhe ownerUid,
// communityId, venueId, estado de moderação, verificação oficial ou métricas.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  buildCommunityOfficialAssociationKey,
  buildVerifiedVenueOfficialAssociation,
  sanitizeCommunityOfficialAssociationPublicProjection,
} from './community-official-association.model';
import {
  OFFICIAL_SPACE_CREATION_POLICY_VERSION,
  evaluateOfficialSpaceCreationGrant,
} from './community-official-space.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import { buildCommunityRankingProjectionPatch } from './community-ranking-sync.policy';
import {
  CreateVenueCommunityRequest,
  CreateVenueCommunityResponse,
  normalizeCreateVenueCommunityRequest,
} from './create-venue-community.model';

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A criação de locais ainda não está disponível neste ambiente.'
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

export const createVenueCommunity = onCall<CreateVenueCommunityRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CreateVenueCommunityResponse> => {
    assertPreviewRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    const command = normalizeCreateVenueCommunityRequest(request.data);

    if (!command) {
      throw new HttpsError(
        'invalid-argument',
        'Revise os dados obrigatórios do local.'
      );
    }

    const officialAssociationKey = buildCommunityOfficialAssociationKey({
      type: 'venue',
      id: command.venueId,
    });

    if (!officialAssociationKey) {
      throw new HttpsError(
        'data-loss',
        'Não foi possível preparar a identidade oficial deste local.'
      );
    }

    return db.runTransaction(async (transaction) => {
      const requestRef = db
        .collection('venue_community_creation_requests')
        .doc(command.requestId);
      const venueRef = db.collection('venues').doc(command.venueId);
      const communityRef = db.collection('communities').doc(command.communityId);
      const ownerMembershipRef = communityRef.collection('members').doc(actorUid);
      const userRef = db.collection('users').doc(actorUid);
      const creationGrantRef = db
        .collection('official_space_creation_grants')
        .doc(actorUid);
      const officialAssociationRef = db
        .collection('community_official_associations')
        .doc(officialAssociationKey);
      const discoveryRef = db
        .collection('community_discovery_index')
        .doc(command.communityId);
      const userIndexRef = db
        .collection('community_user_index')
        .doc(actorUid)
        .collection('items')
        .doc(command.communityId);
      const membershipAuditRef = db
        .collection('community_membership_audit')
        .doc(`venue-create-${command.requestId}`);
      const officialAssociationAuditRef = db
        .collection('community_official_association_audit')
        .doc(`venue-create-${command.requestId}`);

      const [
        requestSnapshot,
        userSnapshot,
        creationGrantSnapshot,
        venueSnapshot,
        communitySnapshot,
        officialAssociationSnapshot,
      ] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(userRef),
        transaction.get(creationGrantRef),
        transaction.get(venueRef),
        transaction.get(communityRef),
        transaction.get(officialAssociationRef),
      ]);

      if (requestSnapshot.exists) {
        const existing = requestSnapshot.data() ?? {};
        const existingActorUid = String(existing['actorUid'] ?? '').trim();
        const existingVenueId = normalizeExistingId(existing['venueId']);
        const existingCommunityId = normalizeExistingId(existing['communityId']);

        if (existingActorUid !== actorUid) {
          throw new HttpsError(
            'permission-denied',
            'Esta solicitação de criação pertence a outro usuário.'
          );
        }

        if (!existingVenueId || !existingCommunityId) {
          throw new HttpsError(
            'data-loss',
            'O registro idempotente da criação está inconsistente.'
          );
        }

        return {
          venueId: existingVenueId,
          communityId: existingCommunityId,
          created: false,
        };
      }

      assertCommunityMembershipActorEligible(
        userSnapshot.exists ? userSnapshot.data() : null,
        actorUid
      );

      const actorUser = userSnapshot.data() ?? {};
      const officialSpaceDecision = evaluateOfficialSpaceCreationGrant({
        actorUid,
        actorUserRole: actorUser['role'],
        rawGrant: creationGrantSnapshot.exists
          ? creationGrantSnapshot.data()
          : null,
      });

      if (!officialSpaceDecision.allowed
        || !officialSpaceDecision.organizationId) {
        throw new HttpsError(
          'permission-denied',
          'O cadastro de Espaço Oficial exige verificação comercial ativa.',
          {
            reason: officialSpaceDecision.denialReason
              === 'grant_inactive'
              ? 'official_space_grant_inactive'
              : 'official_space_verification_required',
          }
        );
      }

      if (officialSpaceDecision.maxOfficialSpaces !== null) {
        const ownedOfficialSpacesQuery = db
          .collection('community_official_associations')
          .where(
            'sponsorOrganizationId',
            '==',
            officialSpaceDecision.organizationId
          )
          .where('target.type', '==', 'venue')
          .where('status', '==', 'verified')
          .limit(officialSpaceDecision.maxOfficialSpaces + 1);
        const ownedOfficialSpacesSnapshot = await transaction.get(
          ownedOfficialSpacesQuery
        );

        if (
          ownedOfficialSpacesSnapshot.size
          >= officialSpaceDecision.maxOfficialSpaces
        ) {
          throw new HttpsError(
            'resource-exhausted',
            'A organização atingiu a quantidade de Espaços Oficiais contratada.',
            {
              reason: 'official_space_creation_limit_reached',
              maxOfficialSpaces: officialSpaceDecision.maxOfficialSpaces,
              currentOfficialSpaces: ownedOfficialSpacesSnapshot.size,
            }
          );
        }
      }

      if (
        venueSnapshot.exists
        || communitySnapshot.exists
        || officialAssociationSnapshot.exists
      ) {
        throw new HttpsError(
          'already-exists',
          'Não foi possível reservar os identificadores deste local.'
        );
      }

      const now = Date.now();
      const officialAssociation = buildVerifiedVenueOfficialAssociation({
        venueId: command.venueId,
        communityId: command.communityId,
        sponsorOrganizationId: officialSpaceDecision.organizationId,
        holderUid: actorUid,
        verifiedAt: now,
        verificationPolicyVersion: OFFICIAL_SPACE_CREATION_POLICY_VERSION,
      });
      const officialAssociationPublic =
        sanitizeCommunityOfficialAssociationPublicProjection(
          officialAssociation
        );

      if (
        !officialAssociation
        || officialAssociation.associationKey !== officialAssociationKey
        || !officialAssociationPublic
      ) {
        throw new HttpsError(
          'data-loss',
          'A identidade oficial deste local ficou inconsistente.'
        );
      }

      const region = {
        uf: command.region.uf,
        city: command.region.city,
        district: command.region.district,
      };
      const metrics = {
        memberCount: 1,
        postCount: 0,
        mediaCount: 0,
      };
      const access = {
        preview: 'authenticated',
        interaction: 'members_only',
        join: command.joinPolicy,
      };
      const source = { type: 'venue', id: command.venueId };
      const communityModeration = {
        state: 'active',
        reviewedAt: now,
        reviewedBy: actorUid,
      };
      const rankingPatch = buildCommunityRankingProjectionPatch(
        {
          description: command.description,
          source,
          moderation: communityModeration,
          metrics,
          createdAt: now,
          updatedAt: now,
        },
        { avatarUrl: null, coverUrl: null },
        now
      );

      transaction.create(venueRef, {
        name: command.name,
        slug: command.slug,
        kind: command.kind,
        description: command.description,
        region,
        addressHint: command.addressHint,
        visibility: 'public',
        status: 'active',
        officialAssociationKey,
        moderation: {
          state: 'active',
          reviewedAt: now,
          reviewedBy: actorUid,
          reason: 'emulator-self-created',
        },
        sponsorship: {
          state: 'none',
          priority: 0,
          startsAt: null,
          endsAt: null,
        },
        chat: {
          enabled: true,
          mode: 'hybrid',
        },
        ownerUid: actorUid,
        adminUids: [],
        createdAt: now,
        updatedAt: now,
      });

      transaction.create(communityRef, {
        name: command.name,
        slug: command.slug,
        description: command.description,
        source,
        status: 'active',
        visibility: 'public_preview',
        ownerUid: actorUid,
        officialAssociationKey,
        access,
        moderation: communityModeration,
        metrics,
        capacity: {
          memberLimit: officialSpaceDecision.memberLimit,
          policyVersion: 1,
        },
        createdAt: now,
        updatedAt: now,
      });

      transaction.create(officialAssociationRef, officialAssociation);

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
        capacity: {
          memberLimit: officialSpaceDecision.memberLimit,
          policyVersion: 1,
        },
        access,
        officialAssociation: officialAssociationPublic,
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
        source: 'venue-community-create',
      });

      transaction.create(userIndexRef, {
        communityId: command.communityId,
        name: command.name,
        source,
        role: 'owner',
        status: 'active',
        updatedAt: now,
      });

      transaction.create(membershipAuditRef, {
        action: 'venue_community_created',
        communityId: command.communityId,
        venueId: command.venueId,
        actorUid,
        organizationId: officialSpaceDecision.organizationId,
        subjectUid: actorUid,
        previousStatus: null,
        nextStatus: 'active',
        previousRole: null,
        nextRole: 'owner',
        createdAt: now,
      });

      transaction.create(officialAssociationAuditRef, {
        action: 'official_association_verified',
        associationKey: officialAssociation.associationKey,
        communityId: command.communityId,
        target: officialAssociation.target,
        actorUid,
        sponsorOrganizationId: officialSpaceDecision.organizationId,
        authorityRole: officialAssociation.authority.role,
        verificationSource: officialAssociation.verification.source,
        verificationPolicyVersion:
          officialAssociation.verification.policyVersion,
        previousStatus: null,
        nextStatus: 'verified',
        createdAt: now,
      });

      transaction.create(requestRef, {
        actorUid,
        organizationId: officialSpaceDecision.organizationId,
        officialAssociationKey,
        venueId: command.venueId,
        communityId: command.communityId,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      });

      return {
        venueId: command.venueId,
        communityId: command.communityId,
        created: true,
      };
    });
  }
);
