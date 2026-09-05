// functions/src/community/get-community-official-claim-capability.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY OFFICIAL CLAIM CAPABILITY
// -----------------------------------------------------------------------------
// O navegador recebe apenas alvos reivindicáveis e papel de autoridade seguro.
// Grants comerciais, organização patrocinadora e evidências permanecem privados.
// -----------------------------------------------------------------------------

import type { DocumentReference } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  buildCommunityOfficialAssociationKey,
  normalizeCommunityOfficialAssociationKey,
} from './community-official-association.model';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  resolveCommunityOfficialClaimCapability,
  type CommunityOfficialClaimCapabilityCandidate,
  type CommunityOfficialClaimCapabilityReason,
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

  // As duas consultas de Local são limitadas a 24 cada. Assim esta verificação
  // canônica também permanece estritamente limitada a no máximo 48 leituras e
  // ocorre apenas no fluxo explícito de Configurações da Comunidade.
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

    const preflight = resolveCommunityOfficialClaimCapability({
      actorUid,
      rawGrant,
      rawVenues: [],
      activeOfficialVenueIds: [],
      communityAlreadyOfficial: storedCommunityAlreadyOfficial,
    });

    if (preflight.reason !== 'no_eligible_target') {
      return {
        ...preflight,
        generatedAt: Date.now(),
      };
    }

    const ownerVenuesQuery = db
      .collection('venues')
      .where('ownerUid', '==', actorUid)
      .limit(QUERY_LIMIT);
    const managedVenuesQuery = db
      .collection('venues')
      .where('adminUids', 'array-contains', actorUid)
      .limit(QUERY_LIMIT);
    const [ownerVenuesSnapshot, managedVenuesSnapshot] = await Promise.all([
      ownerVenuesQuery.get(),
      managedVenuesQuery.get(),
    ]);

    const rawVenues = [
      ...ownerVenuesSnapshot.docs,
      ...managedVenuesSnapshot.docs,
    ].map((snapshot) => ({
      id: snapshot.id,
      ...(snapshot.data() ?? {}),
    }));

    const occupancy = await resolveVenueOfficialOccupancy({
      communityId,
      rawVenues,
    });

    const decision = resolveCommunityOfficialClaimCapability({
      actorUid,
      rawGrant,
      rawVenues,
      activeOfficialVenueIds: occupancy.activeOfficialVenueIds,
      communityAlreadyOfficial:
        storedCommunityAlreadyOfficial || occupancy.communityAlreadyOfficial,
    });

    return {
      ...decision,
      generatedAt: Date.now(),
    };
  }
);
