import { logger } from 'firebase-functions';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import {
  copyPrivatePhotoToPublishedAsset,
  deletePublishedPhotoAssetOrQueue,
} from './published-photo-asset.service';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';

type ModerationStatus = 'PENDING_REVIEW' | 'APPROVED';

type PrivatePhotoDoc = {
  path?: string;
  url?: string;
  fileName?: string;
  alt?: string;
};

type PhotoPublicationDoc = {
  isPublished?: boolean;
  sourceStoragePath?: string;
  publishedStoragePath?: string;
};

const AUTO_APPROVE_PHOTOS =
  process.env.FUNCTIONS_EMULATOR === 'true' ||
  process.env.MEDIA_AUTO_APPROVE_PHOTOS === 'true';

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function resolveSourceStoragePath(
  ownerUid: string,
  photo: PrivatePhotoDoc
): string | null {
  return (
    extractOwnedPrivatePhotoPath(ownerUid, photo.path) ??
    extractOwnedPrivatePhotoPath(ownerUid, photo.url)
  );
}

function hasBinaryChanged(
  ownerUid: string,
  before: PrivatePhotoDoc,
  after: PrivatePhotoDoc
): boolean {
  return (
    resolveSourceStoragePath(ownerUid, before) !==
    resolveSourceStoragePath(ownerUid, after)
  );
}

function hasPublicMetadataChanged(
  before: PrivatePhotoDoc,
  after: PrivatePhotoDoc
): boolean {
  return (
    cleanText(before.alt) !== cleanText(after.alt) ||
    cleanText(before.fileName) !== cleanText(after.fileName)
  );
}

function resolveModerationStatus(): ModerationStatus {
  return AUTO_APPROVE_PHOTOS ? 'APPROVED' : 'PENDING_REVIEW';
}

function resolvePublicAlt(photo: PrivatePhotoDoc): string {
  return cleanText(photo.alt) || cleanText(photo.fileName) || 'Foto do perfil';
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

    const before = (beforeSnapshot.data() ?? {}) as PrivatePhotoDoc;
    const after = (afterSnapshot.data() ?? {}) as PrivatePhotoDoc;
    const binaryChanged = hasBinaryChanged(ownerUid, before, after);
    const metadataChanged = hasPublicMetadataChanged(before, after);

    if (!binaryChanged && !metadataChanged) {
      return;
    }

    const publicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const publicPhotoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const publicationSnapshot = await publicationRef.get();

    if (!publicationSnapshot.exists) {
      return;
    }

    const publication = publicationSnapshot.data() as PhotoPublicationDoc;
    if (publication.isPublished !== true) {
      return;
    }

    const sourceStoragePath = resolveSourceStoragePath(ownerUid, after);
    if (!sourceStoragePath) {
      logger.error(
        '[syncPublishedPhotoOnPrivateUpdate] Foto privada sem caminho válido.',
        { ownerUid, photoId }
      );
      return;
    }

    const now = Date.now();
    const moderationStatus = resolveModerationStatus();
    const sourceAlreadySynchronized =
      cleanText(publication.sourceStoragePath) === sourceStoragePath &&
      !!cleanText(publication.publishedStoragePath);
    const shouldCopyAsset = binaryChanged && !sourceAlreadySynchronized;
    let nextPublishedStoragePath = cleanText(
      publication.publishedStoragePath
    );

    if (shouldCopyAsset) {
      nextPublishedStoragePath = await copyPrivatePhotoToPublishedAsset({
        ownerUid,
        photoId,
        sourceStoragePath,
      });
    }

    const batch = db.batch();
    const publicationPatch: Record<string, unknown> = {
      updatedAt: now,
    };
    const publicPhotoPatch: Record<string, unknown> = {
      alt: resolvePublicAlt(after),
      updatedAt: now,
    };

    if (binaryChanged) {
      publicationPatch['sourceStoragePath'] = sourceStoragePath;
      publicationPatch['publishedStoragePath'] = nextPublishedStoragePath;
      publicationPatch['assetVersion'] = now;
      publicationPatch['moderationStatus'] = moderationStatus;
      publicationPatch['moderationReason'] = null;
      publicationPatch['lastModeratedAt'] =
        moderationStatus === 'APPROVED' ? now : null;

      publicPhotoPatch['moderationStatus'] = moderationStatus;
      publicPhotoPatch['moderationReason'] = null;
    }

    batch.set(publicationRef, publicationPatch, { merge: true });
    batch.set(publicPhotoRef, publicPhotoPatch, { merge: true });

    try {
      await batch.commit();
    } catch (error) {
      if (shouldCopyAsset && nextPublishedStoragePath) {
        await deletePublishedPhotoAssetOrQueue({
          ownerUid,
          photoId,
          storagePath: nextPublishedStoragePath,
          reason: 'sync-published-photo-firestore-rollback',
        });
      }

      throw error;
    }

    const previousPublishedStoragePath = cleanText(
      publication.publishedStoragePath
    );

    if (
      shouldCopyAsset &&
      previousPublishedStoragePath &&
      previousPublishedStoragePath !== nextPublishedStoragePath
    ) {
      await deletePublishedPhotoAssetOrQueue({
        ownerUid,
        photoId,
        storagePath: previousPublishedStoragePath,
        reason: 'sync-published-photo-replace-version',
      });
    }

    await refreshPublicProfileMediaMetrics(ownerUid).catch((error) => {
      logger.error(
        '[syncPublishedPhotoOnPrivateUpdate] Falha ao atualizar métricas.',
        {
          ownerUid,
          photoId,
          error: error instanceof Error ? error.message : String(error ?? ''),
        }
      );
    });

    logger.info('[syncPublishedPhotoOnPrivateUpdate] Sincronização concluída.', {
      ownerUid,
      photoId,
      binaryChanged,
      metadataChanged,
      copiedAsset: shouldCopyAsset,
      moderationStatus,
    });
  }
);
