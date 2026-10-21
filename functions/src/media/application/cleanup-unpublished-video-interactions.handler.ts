import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { canCleanupUnpublishedVideoInteractions } from './video-unpublication-cleanup.policy';

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

    // Revalidate current canonical state: Cloud Events are at-least-once and
    // may arrive after a later write. A registered identity is never cleaned
    // merely because a historical event says it was unpublished.
    const publicationRef = db.doc(`users/${ownerUid}/video_publications/${videoId}`);
    const identityRef = db.doc(`users/${ownerUid}/video_identity_guards/${videoId}`);
    const deletionRef = db.collection('media_video_deletion_jobs')
      .doc(`${ownerUid}_${videoId}`);
    const [publication, identity, deletion] = await Promise.all([
      publicationRef.get(), identityRef.get(), deletionRef.get(),
    ]);
    if (!canCleanupUnpublishedVideoInteractions({
      publicationExists: publication.exists,
      isPublished: publication.exists ? publication.get('isPublished') : null,
      identityState: identity.exists ? identity.get('state') : null,
      deletionRequested: deletion.exists,
    })) {
      return;
    }

    await db.recursiveDelete(publicVideoRef);

    logger.info(
      '[cleanupUnpublishedVideoInteractions] Interações públicas removidas.',
      { ownerUid, videoId }
    );
  }
);
