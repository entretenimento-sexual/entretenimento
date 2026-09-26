import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { logPhotoOperation } from './photo-operation-telemetry';

interface PhotoPublicationState {
  isPublished?: boolean;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

/**
 * Remove a árvore pública de uma foto quando a publicação deixa de existir.
 *
 * Firestore não remove subcoleções ao apagar o documento pai. Sem este
 * cleanup, views, comentários e reações sobreviveriam à exclusão da foto,
 * acumulando retenção e custo órfãos.
 */
export const cleanupUnpublishedPhotoInteractions = onDocumentWritten(
  {
    document: 'users/{ownerUid}/photo_publications/{photoId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const startedAt = Date.now();
    const ownerUid = cleanId(event.params.ownerUid);
    const photoId = cleanId(event.params.photoId);
    const before = event.data?.before.exists
      ? event.data.before.data() as PhotoPublicationState
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data() as PhotoPublicationState
      : null;

    if (
      !ownerUid ||
      !photoId ||
      before?.isPublished !== true ||
      after?.isPublished === true
    ) {
      return;
    }

    const publicPhotoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );

    await db.recursiveDelete(publicPhotoRef);

    logPhotoOperation({
      operation: 'photo.cleanup_public_interactions',
      outcome: 'success',
      startedAt,
      counts: { mediaTreesDeleted: 1 },
    });

    logger.info(
      '[cleanupUnpublishedPhotoInteractions] Interações públicas removidas.',
      { ownerUid, photoId }
    );
  }
);
