// functions/src/community/get-community-official-claim-capability.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY OFFICIAL CLAIM CAPABILITY
// -----------------------------------------------------------------------------
// O navegador recebe apenas alvos reivindicáveis e papel de autoridade seguro.
// Grants comerciais, organização patrocinadora e evidências permanecem privados.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
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
    const ownerVenuesQuery = db
      .collection('venues')
      .where('ownerUid', '==', actorUid)
      .limit(QUERY_LIMIT);
    const managedVenuesQuery = db
      .collection('venues')
      .where('adminUids', 'array-contains', actorUid)
      .limit(QUERY_LIMIT);

    const [
      communitySnapshot,
      grantSnapshot,
      ownerVenuesSnapshot,
      managedVenuesSnapshot,
    ] = await Promise.all([
      communityRef.get(),
      grantRef.get(),
      ownerVenuesQuery.get(),
      managedVenuesQuery.get(),
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

    const rawVenues = [
      ...ownerVenuesSnapshot.docs,
      ...managedVenuesSnapshot.docs,
    ].map((snapshot) => ({
      id: snapshot.id,
      ...(snapshot.data() ?? {}),
    }));

    const decision = resolveCommunityOfficialClaimCapability({
      actorUid,
      rawGrant: grantSnapshot.exists ? grantSnapshot.data() : null,
      rawVenues,
      communityAlreadyOfficial: cleanId(community['officialAssociationKey']) !== null,
    });

    return {
      ...decision,
      generatedAt: Date.now(),
    };
  }
);
