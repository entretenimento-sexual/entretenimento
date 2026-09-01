// functions/src/community/get-profile-official-communities.handler.ts
// -----------------------------------------------------------------------------
// GET PROFILE OFFICIAL COMMUNITIES
// -----------------------------------------------------------------------------
// Recebe exclusivamente o profileId público canônico e devolve somente cards
// públicos cuja associação oficial verificada aponta para esse perfil.
// Memberships pessoais nunca entram nesta resposta e nenhum UID é resolvido ou
// exposto por esta callable.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  assertCommunityCallableAppCheck,
  REQUIRE_COMMUNITY_APP_CHECK,
} from './community-callable-security';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';
import {
  CommunityDiscoveryPageResponse,
  CommunityPreviewCard,
  sanitizeCommunityDiscoveryProjection,
} from './community-preview.model';
import {
  ProfileOfficialCommunitiesRequest,
  normalizeProfileOfficialCommunitiesRequest,
} from './profile-official-communities.model';

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

      const scanLimit = Math.min(command.limit * 3, 24);
      const projectionSnapshot = await db
        .collection('community_discovery_index')
        .where('officialAssociation.target.type', '==', 'profile')
        .where('officialAssociation.target.id', '==', command.profileId)
        .limit(scanLimit)
        .get();

      const items = projectionSnapshot.docs
        .map((document) =>
          sanitizeCommunityDiscoveryProjection(
            document.id,
            document.data()
          )
        )
        .filter((item): item is CommunityPreviewCard => {
          const official = item?.officialAssociation;
          return !!item
            && official?.verified === true
            && official.target.type === 'profile'
            && official.target.id === command.profileId;
        })
        .sort((left, right) => {
          const memberDelta =
            right.metrics.memberCount - left.metrics.memberCount;
          return memberDelta || left.name.localeCompare(right.name, 'pt-BR');
        })
        .slice(0, command.limit);

      return {
        items,
        nextCursor: null,
        generatedAt: Date.now(),
      };
    }
  );
