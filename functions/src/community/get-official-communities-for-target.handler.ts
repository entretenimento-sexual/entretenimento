// functions/src/community/get-official-communities-for-target.handler.ts
// -----------------------------------------------------------------------------
// GET OFFICIAL COMMUNITIES FOR TARGET
// -----------------------------------------------------------------------------
// Endpoint canônico para Perfis, Organizações, Locais e Eventos. Apenas cards
// públicos sanitizados de associações verificadas atravessam esta fronteira.
// Alvos de perfil também precisam existir na projeção pública atual e respeitar
// bloqueio bilateral antes que a associação oficial seja consultada.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  assertNoActiveBilateralBlock,
} from '../friendship/application/bilateral-block-access.policy';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import type { CommunityDiscoveryPageResponse } from './community-preview.model';
import {
  OfficialCommunitiesForTargetRequest,
  normalizeOfficialCommunitiesForTargetRequest,
} from './official-communities-for-target.model';
import { loadOfficialCommunitiesForTarget } from './official-communities.query';
import {
  assertCommunitySocialAccessForUid,
} from './community-social-access.service';

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

function emptyResponse(): CommunityDiscoveryPageResponse {
  return {
    items: [],
    nextCursor: null,
    generatedAt: Date.now(),
  };
}

export const getOfficialCommunitiesForTarget =
  onCall<OfficialCommunitiesForTargetRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<CommunityDiscoveryPageResponse> => {
      assertCommunityCallableAppCheck(request.app);
      assertRuntime();

      const uid = String(request.auth?.uid ?? '').trim();
      if (!uid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      if (request.auth?.token?.['email_verified'] !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Verifique seu e-mail para continuar.'
        );
      }

      await assertCommunitySocialAccessForUid(uid);

      const command = normalizeOfficialCommunitiesForTargetRequest(request.data);
      if (!command) {
        throw new HttpsError(
          'invalid-argument',
          'A entidade oficial informada não é válida.'
        );
      }

      if (command.target.type === 'profile') {
        const publicProfilesSnapshot = await db
          .collection('public_profiles')
          .where('profileId', '==', command.target.id)
          .limit(2)
          .get();

        if (publicProfilesSnapshot.size > 1) {
          throw new HttpsError(
            'data-loss',
            'A identidade pública do perfil está inconsistente.',
            { reason: 'public_profile_identity_duplicate' }
          );
        }

        const targetProfileSnapshot = publicProfilesSnapshot.docs[0];
        if (!targetProfileSnapshot) {
          return emptyResponse();
        }

        const targetUid = String(targetProfileSnapshot.id ?? '').trim();
        if (!targetUid || targetUid.length > 128) {
          throw new HttpsError(
            'data-loss',
            'A identidade pública do perfil está inconsistente.',
            { reason: 'public_profile_identity_invalid' }
          );
        }

        await assertNoActiveBilateralBlock(
          uid,
          targetUid,
          'Perfil indisponível.'
        );
      }

      return loadOfficialCommunitiesForTarget(command.target, command.limit);
    }
  );
