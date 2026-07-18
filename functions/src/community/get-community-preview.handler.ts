// functions/src/community/get-community-preview.handler.ts
// -----------------------------------------------------------------------------
// GET COMMUNITY PREVIEW
// -----------------------------------------------------------------------------
// Retorna somente metadados comunitários sanitizados e o papel do próprio viewer.
// Publicações, mídia e listas de membros não fazem parte deste endpoint.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { isFunctionsEmulatorRuntime } from '../shared/runtime/functions-runtime.guard';
import {
  CommunityPreviewRequest,
  CommunityPreviewResponse,
  normalizeCommunityId,
} from './community-preview.model';
import { getCommunityViewerContext } from './community-viewer-access.service';

function assertPreviewRuntime(): void {
  if (isFunctionsEmulatorRuntime()) return;

  throw new HttpsError(
    'failed-precondition',
    'As comunidades ainda não estão disponíveis neste ambiente.'
  );
}

export const getCommunityPreview = onCall<CommunityPreviewRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CommunityPreviewResponse> => {
    assertPreviewRuntime();

    const uid = request.auth?.uid ?? null;
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (request.auth?.token.email_verified !== true) {
      throw new HttpsError(
        'failed-precondition',
        'Verifique seu e-mail para continuar.'
      );
    }

    const communityId = normalizeCommunityId(request.data?.communityId);
    if (!communityId) {
      throw new HttpsError('invalid-argument', 'Comunidade inválida.');
    }

    const context = await getCommunityViewerContext(uid, communityId);

    return {
      community: context.community,
      viewerMode: context.viewerMode,
      canInteract: context.canInteract,
      generatedAt: Date.now(),
    };
  }
);
