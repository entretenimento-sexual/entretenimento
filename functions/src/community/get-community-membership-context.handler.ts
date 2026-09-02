// functions/src/community/get-community-membership-context.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY MEMBERSHIP CONTEXT
// -----------------------------------------------------------------------------
// Resolve somente o vínculo do próprio usuário para IDs de Comunidades que o
// cliente já recebeu na Discovery. Não lista memberships, não retorna roles e
// não expõe qualquer vínculo de terceiros.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import {
  isCommunityMembershipContextActive,
  normalizeCommunityMembershipContextIds,
} from './community-membership-context.policy';
import { assertCommunityMembershipActorEligible } from './community-membership-eligibility.service';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

interface CommunityMembershipContextPayload {
  communityIds?: unknown;
}

interface CommunityMembershipContextResponse {
  activeCommunityIds: readonly string[];
  generatedAt: number;
}

function assertPreviewRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

export const getCommunityMembershipContext =
  onCall<CommunityMembershipContextPayload>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityMembershipContextResponse> => {
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

      const communityIds = normalizeCommunityMembershipContextIds(
        request.data?.communityIds
      );
      if (!communityIds) {
        throw new HttpsError(
          'invalid-argument',
          'Lista de Comunidades inválida.'
        );
      }

      const userSnapshot = await db.collection('users').doc(uid).get();
      assertCommunityMembershipActorEligible(
        userSnapshot.exists ? userSnapshot.data() : null,
        uid
      );

      const membershipRefs = communityIds.map((communityId) =>
        db.collection('communities').doc(communityId).collection('members').doc(uid)
      );
      const membershipSnapshots = await db.getAll(...membershipRefs);
      const activeCommunityIds = membershipSnapshots
        .map((snapshot, index) =>
          snapshot.exists && isCommunityMembershipContextActive(snapshot.data())
            ? communityIds[index]
            : null
        )
        .filter((communityId): communityId is string => communityId !== null);

      return {
        activeCommunityIds,
        generatedAt: Date.now(),
      };
    }
  );
