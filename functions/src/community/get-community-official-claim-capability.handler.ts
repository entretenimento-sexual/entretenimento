// functions/src/community/get-community-official-claim-capability.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY OFFICIAL CLAIM CAPABILITY
// -----------------------------------------------------------------------------
// O navegador recebe apenas alvos reivindicáveis e papel de autoridade seguro.
// Grants comerciais, KYC/KYB, representação e evidências permanecem privados.
// -----------------------------------------------------------------------------

import type { DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildEventAuthorityRecordId,
} from '../authority/event-authority.policy';
import { normalizeOrganizationId } from '../organization/organization.model';
import {
  buildOrganizationRepresentationId,
  evaluateOrganizationRepresentation,
} from '../organization/organization-representation.policy';
import {
  buildCommunityOfficialAssociationKey,
  normalizeCommunityOfficialAssociationKey,
} from './community-official-association.model';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  MAX_COMMUNITY_OFFICIAL_CLAIM_CANDIDATES,
  resolveCommunityOfficialClaimCapability,
  type CommunityOfficialClaimCapabilityCandidate,
  type CommunityOfficialClaimCapabilityReason,
  type CommunityOfficialClaimEventAuthorityInput,
  type CommunityOfficialClaimOrganizationAuthorityInput,
  type CommunityOfficialClaimProfileAuthorityInput,
} from './community-official-claim-capability.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import { assertCommunitySocialAccessForUid } from './community-social-access.service';
import {
  resolveCanonicalOfficialCommunityReferenceFromAssociation,
} from './official-communities.query';

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const QUERY_LIMIT = 24;

export interface GetCommunityOfficialClaimCapabilityRequest {
  readonly communityId?: unknown;
}

export interface GetCommunityOfficialClaimCapabilityResponse {
  readonly canSubmit: boolean;
  readonly reason: CommunityOfficialClaimCapabilityReason;
  readonly candidates: readonly CommunityOfficialClaimCapabilityCandidate[];
  readonly generatedAt: number;
}

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;
  throw new HttpsError(
    'failed-precondition',
    'A verificação de Comunidades Oficiais ainda não está disponível neste ambiente.'
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

async function resolveStoredCommunityOfficialState(input: {
  readonly communityId: string;
  readonly rawCommunity: Readonly<Record<string, unknown>>;
}): Promise<boolean> {
  const associationKey = normalizeCommunityOfficialAssociationKey(
    input.rawCommunity['officialAssociationKey']
  );
  if (!associationKey) return false;

  const snapshot = await db
    .collection('community_official_associations')
    .doc(associationKey)
    .get();
  if (!snapshot.exists) return false;

  const reference = resolveCanonicalOfficialCommunityReferenceFromAssociation(
    snapshot.data()
  );
  return reference?.communityId === input.communityId;
}

async function resolveProfileOfficialOccupancy(input: {
  readonly communityId: string;
  readonly profileId: string | null;
}): Promise<Readonly<{
  activeOfficialProfileIds: readonly string[];
  communityAlreadyOfficial: boolean;
}>> {
  const profileId = cleanId(input.profileId);
  if (!profileId) {
    return Object.freeze({
      activeOfficialProfileIds: Object.freeze([]),
      communityAlreadyOfficial: false,
    });
  }

  const associationKey = buildCommunityOfficialAssociationKey({
    type: 'profile',
    id: profileId,
  });
  if (!associationKey) {
    return Object.freeze({
      activeOfficialProfileIds: Object.freeze([]),
      communityAlreadyOfficial: false,
    });
  }

  const snapshot = await db
    .collection('community_official_associations')
    .doc(associationKey)
    .get();
  if (!snapshot.exists) {
    return Object.freeze({
      activeOfficialProfileIds: Object.freeze([]),
      communityAlreadyOfficial: false,
    });
  }

  const reference = resolveCanonicalOfficialCommunityReferenceFromAssociation(
    snapshot.data()
  );
  if (
    !reference
    || reference.target.type !== 'profile'
    || reference.target.id !== profileId
  ) {
    return Object.freeze({
      activeOfficialProfileIds: Object.freeze([]),
      communityAlreadyOfficial: false,
    });
  }

  return Object.freeze({
    activeOfficialProfileIds: Object.freeze([profileId]),
    communityAlreadyOfficial: reference.communityId === input.communityId,
  });
}

async function resolveVenueOfficialOccupancy(input: {
  readonly communityId: string;
  readonly rawVenues: readonly Readonly<Record<string, unknown>>[];
}): Promise<Readonly<{
  activeOfficialVenueIds: readonly string[];
  communityAlreadyOfficial: boolean;
}>> {
  const associationRefs = new Map<string, DocumentReference>();

  for (const rawVenue of input.rawVenues) {
    const venueId = cleanId(rawVenue['id']);
    if (!venueId) continue;

    const associationKey = buildCommunityOfficialAssociationKey({
      type: 'venue',
      id: venueId,
    });
    if (!associationKey || associationRefs.has(associationKey)) continue;

    associationRefs.set(
      associationKey,
      db.collection('community_official_associations').doc(associationKey)
    );
  }

  if (associationRefs.size === 0) {
    return Object.freeze({
      activeOfficialVenueIds: Object.freeze([]),
      communityAlreadyOfficial: false,
    });
  }

  // As duas consultas de Local são limitadas a 24 cada. Esta confirmação é
  // executada somente ao abrir o fluxo explícito de Configurações da Comunidade.
  const snapshots = await db.getAll(...associationRefs.values());
  const activeOfficialVenueIds = new Set<string>();
  let communityAlreadyOfficial = false;

  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;

    const reference = resolveCanonicalOfficialCommunityReferenceFromAssociation(
      snapshot.data()
    );
    if (!reference) continue;

    if (reference.communityId === input.communityId) {
      communityAlreadyOfficial = true;
    }
    if (reference.target.type === 'venue') {
      activeOfficialVenueIds.add(reference.target.id);
    }
  }

  return Object.freeze({
    activeOfficialVenueIds: Object.freeze([...activeOfficialVenueIds]),
    communityAlreadyOfficial,
  });
}

async function resolveOrganizationAuthorityInputs(input: {
  readonly actorUid: string;
  readonly now: number;
}): Promise<readonly CommunityOfficialClaimOrganizationAuthorityInput[]> {
  // Consulta estritamente limitada. Registros inativos/históricos são filtrados
  // antes de qualquer leitura de Organização/KYB para conter custo.
  const representationsSnapshot = await db
    .collection('organization_representations')
    .where('holderUid', '==', input.actorUid)
    .limit(QUERY_LIMIT)
    .get();

  const representations = new Map<string, Readonly<Record<string, unknown>>>();
  for (const snapshot of representationsSnapshot.docs) {
    if (representations.size >= MAX_COMMUNITY_OFFICIAL_CLAIM_CANDIDATES) break;

    const rawRepresentation = snapshot.data() ?? {};
    const organizationId = normalizeOrganizationId(
      rawRepresentation['organizationId']
    );
    const expectedRepresentationId = buildOrganizationRepresentationId(
      organizationId,
      input.actorUid
    );
    if (
      !organizationId
      || !expectedRepresentationId
      || snapshot.id !== expectedRepresentationId
      || representations.has(organizationId)
    ) {
      continue;
    }

    const representation = evaluateOrganizationRepresentation({
      organizationId,
      actorUid: input.actorUid,
      requiredScope: 'community_official_claim',
      rawRepresentation,
      now: input.now,
    });
    if (!representation.allowed) continue;

    representations.set(organizationId, rawRepresentation);
  }

  if (representations.size === 0) return Object.freeze([]);

  const organizationIds = [...representations.keys()];
  const refs = organizationIds.flatMap((organizationId) => [
    db.collection('organizations').doc(organizationId),
    db.collection('organization_kyb_records').doc(organizationId),
  ]);
  const snapshots = await db.getAll(...refs);

  return Object.freeze(organizationIds.map((organizationId, index) => {
    const organizationSnapshot = snapshots[index * 2];
    const kybSnapshot = snapshots[index * 2 + 1];
    return Object.freeze({
      organizationId,
      rawOrganization: organizationSnapshot?.exists
        ? organizationSnapshot.data() ?? null
        : null,
      rawKyb: kybSnapshot?.exists ? kybSnapshot.data() : null,
      rawRepresentation: representations.get(organizationId) ?? null,
    });
  }));
}

async function resolveEventAuthorityInputs(input: {
  readonly actorUid: string;
}): Promise<readonly CommunityOfficialClaimEventAuthorityInput[]> {
  const snapshot = await db
    .collection('event_authority_records')
    .where('holderUid', '==', input.actorUid)
    .limit(QUERY_LIMIT)
    .get();
  const result: CommunityOfficialClaimEventAuthorityInput[] = [];

  for (const document of snapshot.docs) {
    if (result.length >= MAX_COMMUNITY_OFFICIAL_CLAIM_CANDIDATES) break;

    const rawAuthorization = document.data() ?? {};
    const eventId = cleanId(rawAuthorization['eventId']);
    const expectedId = buildEventAuthorityRecordId(eventId, input.actorUid);
    if (!eventId || !expectedId || document.id !== expectedId) continue;

    result.push(Object.freeze({
      authorizationId: document.id,
      rawAuthorization,
    }));
  }

  return Object.freeze(result);
}

async function resolveEventOfficialOccupancy(input: {
  readonly communityId: string;
  readonly eventIds: readonly string[];
}): Promise<Readonly<{
  activeOfficialEventIds: readonly string[];
  communityAlreadyOfficial: boolean;
}>> {
  const associationRefs = new Map<string, DocumentReference>();

  for (const rawEventId of input.eventIds) {
    const eventId = cleanId(rawEventId);
    if (!eventId) continue;

    const associationKey = buildCommunityOfficialAssociationKey({
      type: 'event',
      id: eventId,
    });
    if (!associationKey || associationRefs.has(associationKey)) continue;

    associationRefs.set(
      associationKey,
      db.collection('community_official_associations').doc(associationKey)
    );
  }

  if (associationRefs.size === 0) {
    return Object.freeze({
      activeOfficialEventIds: Object.freeze([]),
      communityAlreadyOfficial: false,
    });
  }

  const snapshots = await db.getAll(...associationRefs.values());
  const activeOfficialEventIds = new Set<string>();
  let communityAlreadyOfficial = false;

  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;

    const reference = resolveCanonicalOfficialCommunityReferenceFromAssociation(
      snapshot.data()
    );
    if (!reference) continue;

    if (reference.communityId === input.communityId) {
      communityAlreadyOfficial = true;
    }
    if (reference.target.type === 'event') {
      activeOfficialEventIds.add(reference.target.id);
    }
  }

  return Object.freeze({
    activeOfficialEventIds: Object.freeze([...activeOfficialEventIds]),
    communityAlreadyOfficial,
  });
}

async function resolveOrganizationOfficialOccupancy(input: {
  readonly communityId: string;
  readonly organizationIds: readonly string[];
}): Promise<Readonly<{
  activeOfficialOrganizationIds: readonly string[];
  communityAlreadyOfficial: boolean;
}>> {
  const associationRefs = new Map<string, DocumentReference>();
  for (const rawOrganizationId of input.organizationIds) {
    const organizationId = cleanId(rawOrganizationId);
    if (!organizationId) continue;

    const associationKey = buildCommunityOfficialAssociationKey({
      type: 'organization',
      id: organizationId,
    });
    if (!associationKey || associationRefs.has(associationKey)) continue;

    associationRefs.set(
      associationKey,
      db.collection('community_official_associations').doc(associationKey)
    );
  }

  if (associationRefs.size === 0) {
    return Object.freeze({
      activeOfficialOrganizationIds: Object.freeze([]),
      communityAlreadyOfficial: false,
    });
  }

  const snapshots = await db.getAll(...associationRefs.values());
  const activeOfficialOrganizationIds = new Set<string>();
  let communityAlreadyOfficial = false;

  for (const snapshot of snapshots) {
    if (!snapshot.exists) continue;

    const reference = resolveCanonicalOfficialCommunityReferenceFromAssociation(
      snapshot.data()
    );
    if (!reference) continue;

    if (reference.communityId === input.communityId) {
      communityAlreadyOfficial = true;
    }
    if (reference.target.type === 'organization') {
      activeOfficialOrganizationIds.add(reference.target.id);
    }
  }

  return Object.freeze({
    activeOfficialOrganizationIds: Object.freeze([
      ...activeOfficialOrganizationIds,
    ]),
    communityAlreadyOfficial,
  });
}

export const getCommunityOfficialClaimCapability = onCall<
  GetCommunityOfficialClaimCapabilityRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<GetCommunityOfficialClaimCapabilityResponse> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);
    const actorUid = assertAuthenticatedUid(request.auth);
    await assertCommunitySocialAccessForUid(actorUid);

    const communityId = cleanId(request.data?.communityId);
    if (!communityId) {
      throw new HttpsError(
        'invalid-argument',
        'Informe uma Comunidade válida para consultar a verificação oficial.'
      );
    }

    const communityRef = db.collection('communities').doc(communityId);
    const grantRef = db.collection('official_space_creation_grants').doc(actorUid);
    const [communitySnapshot, grantSnapshot] = await Promise.all([
      communityRef.get(),
      grantRef.get(),
    ]);

    if (!communitySnapshot.exists) {
      throw new HttpsError('not-found', 'A Comunidade não foi encontrada.');
    }

    const community = communitySnapshot.data() ?? {};
    if (
      community['status'] !== 'active'
      || cleanId(community['ownerUid']) !== actorUid
    ) {
      throw new HttpsError(
        'permission-denied',
        'Somente o proprietário de uma Comunidade ativa pode consultar este vínculo.'
      );
    }

    const rawGrant = grantSnapshot.exists ? grantSnapshot.data() : null;
    const storedCommunityAlreadyOfficial = await resolveStoredCommunityOfficialState({
      communityId,
      rawCommunity: community,
    });

    if (storedCommunityAlreadyOfficial) {
      const decision = resolveCommunityOfficialClaimCapability({
        actorUid,
        rawGrant,
        rawVenues: [],
        rawOrganizationAuthorities: [],
        rawEventAuthorities: [],
        activeOfficialProfileIds: [],
        activeOfficialVenueIds: [],
        activeOfficialOrganizationIds: [],
        activeOfficialEventIds: [],
        communityAlreadyOfficial: true,
      });
      return { ...decision, generatedAt: Date.now() };
    }

    const now = Date.now();
    const venuePreflight = resolveCommunityOfficialClaimCapability({
      actorUid,
      rawGrant,
      rawVenues: [],
      rawOrganizationAuthorities: [],
      rawEventAuthorities: [],
      activeOfficialProfileIds: [],
      activeOfficialVenueIds: [],
      activeOfficialOrganizationIds: [],
      activeOfficialEventIds: [],
      communityAlreadyOfficial: false,
      now,
    });

    const rawVenuesPromise: Promise<Readonly<Record<string, unknown>>[]> =
      venuePreflight.reason === 'no_eligible_target'
        ? Promise.all([
          db.collection('venues')
            .where('ownerUid', '==', actorUid)
            .limit(QUERY_LIMIT)
            .get(),
          db.collection('venues')
            .where('adminUids', 'array-contains', actorUid)
            .limit(QUERY_LIMIT)
            .get(),
        ]).then(([ownerVenuesSnapshot, managedVenuesSnapshot]) => [
          ...ownerVenuesSnapshot.docs,
          ...managedVenuesSnapshot.docs,
        ].map((snapshot) => ({
          id: snapshot.id,
          ...(snapshot.data() ?? {}),
        })))
        : Promise.resolve([]);

    const profileAuthorityPromise: Promise<CommunityOfficialClaimProfileAuthorityInput> =
      Promise.all([
        db.collection('users').doc(actorUid).get(),
        db.collection('profile_kyc_records').doc(actorUid).get(),
      ]).then(([userSnapshot, profileKycSnapshot]) => Object.freeze({
        rawUser: userSnapshot.exists ? userSnapshot.data() ?? null : null,
        rawKyc: profileKycSnapshot.exists ? profileKycSnapshot.data() : null,
      }));

    const [
      rawVenues,
      rawOrganizationAuthorities,
      rawEventAuthorities,
      rawProfileAuthority,
    ] = await Promise.all([
      rawVenuesPromise,
      resolveOrganizationAuthorityInputs({ actorUid, now }),
      resolveEventAuthorityInputs({ actorUid }),
      profileAuthorityPromise,
    ]);

    const profileId = cleanId(rawProfileAuthority.rawUser?.['profileId']);
    const [
      profileOccupancy,
      venueOccupancy,
      organizationOccupancy,
      eventOccupancy,
    ] = await Promise.all([
      resolveProfileOfficialOccupancy({ communityId, profileId }),
      resolveVenueOfficialOccupancy({ communityId, rawVenues }),
      resolveOrganizationOfficialOccupancy({
        communityId,
        organizationIds: rawOrganizationAuthorities.map(
          (item) => item.organizationId
        ),
      }),
      resolveEventOfficialOccupancy({
        communityId,
        eventIds: rawEventAuthorities
          .map((item) => cleanId(item.rawAuthorization?.['eventId']))
          .filter((eventId): eventId is string => eventId !== null),
      }),
    ]);

    const decision = resolveCommunityOfficialClaimCapability({
      actorUid,
      rawGrant,
      rawVenues,
      rawProfileAuthority,
      rawOrganizationAuthorities,
      rawEventAuthorities,
      activeOfficialProfileIds: profileOccupancy.activeOfficialProfileIds,
      activeOfficialVenueIds: venueOccupancy.activeOfficialVenueIds,
      activeOfficialOrganizationIds:
        organizationOccupancy.activeOfficialOrganizationIds,
      activeOfficialEventIds: eventOccupancy.activeOfficialEventIds,
      communityAlreadyOfficial:
        profileOccupancy.communityAlreadyOfficial
        || venueOccupancy.communityAlreadyOfficial
        || organizationOccupancy.communityAlreadyOfficial
        || eventOccupancy.communityAlreadyOfficial,
      now,
    });

    return {
      ...decision,
      generatedAt: Date.now(),
    };
  }
);
