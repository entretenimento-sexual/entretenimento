import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';

interface VideoPublicationState {
  isPublished?: boolean;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

export const cleanupUnpublishedVideoInteractions = onDocumentWritten(
  {
    document: 'users/{ownerUid}/video_publications/{videoId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const ownerUid = cleanId(event.params.ownerUid);
    const videoId = cleanId(event.params.videoId);
    const before = event.data?.before.exists
      ? event.data.before.data() as VideoPublicationState
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data() as VideoPublicationState
      : null;

    if (
      !ownerUid ||
      !videoId ||
      before?.isPublished !== true ||
      after?.isPublished === true
    ) {
      return;
    }

    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );

    await db.recursiveDelete(publicVideoRef);

    logger.info(
      '[cleanupUnpublishedVideoInteractions] Interações públicas removidas.',
      { ownerUid, videoId }
    );
  }
);
