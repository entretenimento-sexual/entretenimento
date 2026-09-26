import { logger } from 'firebase-functions';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  copyPrivatePhotoToPublishedAsset,
  deletePublishedPhotoAssetOrQueue,
} from './published-photo-asset.service';
import {
  PHOTO_PREVENTIVE_REVIEW_MESSAGE,
  PHOTO_PREVENTIVE_REVIEW_REASON,
  buildPreventivePhotoReviewId,
} from './photo-publication-moderation.policy';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import {
  PhotoPublicationDoc,
  PrivatePhotoDoc,
  synchronizePublishedPhotoUpdate,
} from './sync-published-photo-on-private-update.use-case';

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
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
          const assetVersion = Number(commit.publicationPatch['assetVersion']);
          const needsPreventiveReview =
            commit.publicationPatch['moderationStatus'] === 'PENDING_REVIEW' &&
            Number.isFinite(assetVersion) &&
            assetVersion > 0;

          if (needsPreventiveReview) {
            const moderationReportId = buildPreventivePhotoReviewId(
              ownerUid,
              photoId,
              assetVersion
            );
            const moderationReportRef = db
              .collection('moderation_reports')
              .doc(moderationReportId);

            batch.set(
              publicationRef,
              {
                ...commit.publicationPatch,
                preventiveReviewReportId: moderationReportId,
              },
              { merge: true }
            );
            batch.set(
              publicPhotoRef,
              {
                ...commit.publicPhotoPatch,
                preventiveReviewReportId: moderationReportId,
              },
              { merge: true }
            );
            batch.create(moderationReportRef, {
              reporterUid: 'system',
              targetType: 'photo',
              targetId: photoId,
              parentTargetId: null,
              targetOwnerUid: ownerUid,
              targetAuthorUid: ownerUid,
              reason: PHOTO_PREVENTIVE_REVIEW_REASON,
              details: PHOTO_PREVENTIVE_REVIEW_MESSAGE,
              route: null,
              status: 'open',
              moderationAction: null,
              contentQuarantined: true,
              evidencePreservationStatus: 'NOT_REQUIRED',
              evidenceRetentionStatus: 'PUBLISHED_ASSET_LOCKED',
              legalReviewStatus: null,
              source: 'system',
              reviewAssetVersion: assetVersion,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          } else {
            batch.set(publicationRef, commit.publicationPatch, { merge: true });
            batch.set(publicPhotoRef, commit.publicPhotoPatch, { merge: true });
          }

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