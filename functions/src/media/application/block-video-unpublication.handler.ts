import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';

interface UnpublishVideoRequest {
  ownerUid?: string;
  videoId?: string;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

/**
 * Compatibilidade explícita para clientes antigos.
 *
 * Vídeos tecnicamente válidos seguem o fluxo único de publicação automática.
 * Para retirar o conteúdo da plataforma, o proprietário deve usar
 * `deleteProfileVideo`, que coordena projeções, interações, processamento,
 * quota e limpeza física no backend.
 */
export const unpublishVideo = onCall<UnpublishVideoRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<never> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    if (requesterUid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'Você só pode administrar vídeos do seu próprio perfil.'
      );
    }

    throw new HttpsError(
      'failed-precondition',
      'Vídeos publicados não podem ser mantidos como arquivos privados. ' +
        'Para retirar este conteúdo da plataforma, exclua o vídeo ' +
        'definitivamente.'
    );
  }
);
