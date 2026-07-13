import { logger } from 'firebase-functions';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  copyPrivatePhotoToPublishedAsset,
  deletePublishedPhotoAssetOrQueue,
} from './published-photo-asset.service';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import {
  PhotoPublicationDoc,
  PrivatePhotoDoc,
  synchronizePublishedPhotoUpdate,
} from './sync-published-photo-on-private-update.use-case';

const AUTO_APPROVE_PHOTOS =
  process.env.FUNCTIONS_EMULATOR === 'true' ||
  process.env.MEDIA_AUTO_APPROVE_PHOTOS === 'true';

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveModerationStatus(): 'PENDING_REVIEW' | 'APPROVED' {
  return AUTO_APPROVE_PHOTOS ? 'APPROVED' : 'PENDING_REVIEW';
}

export const syncPublishedPhotoOnPrivateUpdate = onDocumentUpdated(
  {
    document: 'users/{ownerUid}/photos/{photoId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event): Promise<void> => {
    const ownerUid = cleanText(event.params.ownerUid);
    const photoId = cleanText(event.params.photoId);
    const beforeSnapshot = event.data?.before;
    const afterSnapshot = event.data?.after;

    if (!ownerUid || !photoId || !beforeSnapshot || !afterSnapshot) {
      return;
    }

    const publicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const publicPhotoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const result = await synchronizePublishedPhotoUpdate(
      {
        ownerUid,
        photoId,
        before: (beforeSnapshot.data() ?? {}) as PrivatePhotoDoc,
        after: (afterSnapshot.data() ?? {}) as PrivatePhotoDoc,
      },
      {
        moderationStatus: resolveModerationStatus(),
        now: () => Date.now(),
        loadPublication: async () => {
          const snapshot = await publicationRef.get();
          return snapshot.exists
            ? (snapshot.data() as PhotoPublicationDoc)
            : null;
        },
        copyPublishedAsset: copyPrivatePhotoToPublishedAsset,
        commitPatches: async (commit) => {
          const batch = db.batch();
          batch.set(publicationRef, commit.publicationPatch, { merge: true });
          batch.set(publicPhotoRef, commit.publicPhotoPatch, { merge: true });
          await batch.commit();
        },
        deletePublishedAsset: deletePublishedPhotoAssetOrQueue,
        refreshMetrics: refreshPublicProfileMediaMetrics,
        logError: (message, context) => logger.error(message, context),
      }
    );

    if (result.status !== 'synchronized') {
      return;
    }

    logger.info('[syncPublishedPhotoOnPrivateUpdate] Sincronização concluída.', {
      ownerUid,
      photoId,
      binaryChanged: result.binaryChanged,
      metadataChanged: result.metadataChanged,
      copiedAsset: result.copiedAsset,
      moderationStatus: result.moderationStatus,
    });
  }
);
