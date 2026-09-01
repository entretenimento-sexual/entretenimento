// functions/src/community/get-official-communities-for-target.handler.ts
// -----------------------------------------------------------------------------
// GET OFFICIAL COMMUNITIES FOR TARGET
// -----------------------------------------------------------------------------
// Endpoint canônico para Perfis, Organizações, Locais e Eventos. Apenas cards
// públicos sanitizados de associações verificadas atravessam esta fronteira.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
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

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
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

      if (!request.auth?.uid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      if (request.auth.token?.['email_verified'] !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Verifique seu e-mail para continuar.'
        );
      }

      const command = normalizeOfficialCommunitiesForTargetRequest(request.data);
      if (!command) {
        throw new HttpsError(
          'invalid-argument',
          'A entidade oficial informada não é válida.'
        );
      }

      return loadOfficialCommunitiesForTarget(command.target, command.limit);
    }
  );
