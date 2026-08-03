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
 * Mantém a callable publicada para clientes antigos, mas encerra o modelo de
 * biblioteca privada. Um vídeo publicado só sai do perfil por exclusão segura,
 * que também remove projeções, interações e ativos associados.
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
        'Você só pode gerenciar vídeos do próprio perfil.'
      );
    }

    throw new HttpsError(
      'failed-precondition',
      'Vídeos publicados não podem ser removidos do perfil. Exclua o vídeo para removê-lo definitivamente.'
    );
  }
);
