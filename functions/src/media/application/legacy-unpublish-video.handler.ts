import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';

interface LegacyUnpublishVideoRequest {
  ownerUid?: string;
  videoId?: string;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

/**
 * Compatibilidade fail-closed para clientes antigos.
 *
 * O produto não possui mais "despublicar e manter privado". Mantemos o nome
 * da Function durante a transição para que versões antigas não transformem um
 * vídeo público em rascunho privado. A remoção suportada é deleteProfileVideo,
 * que exige uma ação explícita de exclusão total no cliente atual.
 */
export const unpublishVideo = onCall<LegacyUnpublishVideoRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => {
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
      'Despublicar mantendo o vídeo privado não é mais suportado. ' +
        'Use a exclusão definitiva para remover o vídeo da plataforma.'
    );
  }
);