import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';

interface LegacyUnpublishPhotoRequest {
  ownerUid?: string;
  photoId?: string;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

/**
 * Compatibilidade fail-closed com clientes antigos.
 *
 * O produto deixa de suportar o estado permanente "publicada -> privada".
 * Uma foto publicada permanece publicada até edição, quarentena de segurança
 * ou exclusão definitiva. Isso também impede que uma rota legada destrua o
 * ativo publicado durante uma investigação/moderação em andamento.
 */
export const unpublishPhoto = onCall<LegacyUnpublishPhotoRequest>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
    }

    if (requesterUid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'Você só pode gerenciar fotos do seu próprio perfil.'
      );
    }

    throw new HttpsError(
      'failed-precondition',
      'Ocultar uma foto publicada mantendo-a privada não é mais suportado. ' +
        'Edite a publicação ou exclua a foto definitivamente.'
    );
  }
);
