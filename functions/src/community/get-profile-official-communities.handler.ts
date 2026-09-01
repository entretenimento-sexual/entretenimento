// functions/src/community/get-profile-official-communities.handler.ts
// -----------------------------------------------------------------------------
// GET PROFILE OFFICIAL COMMUNITIES
// -----------------------------------------------------------------------------
// Compatibilidade nominal para consumidores existentes. A leitura real é a
// consulta canônica por alvo oficial; nenhum UID é resolvido ou exposto aqui.
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
  ProfileOfficialCommunitiesRequest,
  normalizeProfileOfficialCommunitiesRequest,
} from './profile-official-communities.model';
import { loadOfficialCommunitiesForTarget } from './official-communities.query';

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

export const getProfileOfficialCommunities =
  onCall<ProfileOfficialCommunitiesRequest>(
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

      const command = normalizeProfileOfficialCommunitiesRequest(request.data);
      if (!command) {
        throw new HttpsError(
          'invalid-argument',
          'O perfil informado não é válido.'
        );
      }

      return loadOfficialCommunitiesForTarget(
        { type: 'profile', id: command.profileId },
        command.limit
      );
    }
  );
