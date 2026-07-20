// functions/src/account_lifecycle/account-owned-media-deletion.firestore.ts
// -----------------------------------------------------------------------------
// FIREBASE ADAPTER FOR OWNED MEDIA AND STORAGE DELETION
// -----------------------------------------------------------------------------
// O escopo é deliberadamente restrito ao namespace e aos metadados de mídia do
// próprio usuário. Mensagens, denúncias, evidências e registros financeiros não
// são tocados por este adaptador.
// -----------------------------------------------------------------------------
import { db, storage } from '../firebaseApp';
import { deletePublishedPhotoAssetOrQueue } from '../media/application/published-photo-asset.service';
import { deletePublishedVideoAssetOrQueue } from '../media/application/published-video-asset.service';
import { extractOwnedPrivatePhotoPath } from '../media/application/photo-storage-path';
import {
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
} from '../media/application/video-processing-job';
import {
  extractOwnedPrivateVideoPath,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedProcessedVideoPrefix,
} from '../media/application/video-storage-path';
import { FirestoreAccountDataDeletionAdapter } from './account-data-deletion.firestore';
import type {
  AccountOwnedMediaDeletionAdapter,
  OwnedMediaCleanupJobKind,
  OwnedVideoProcessingPageSummary,
} from './account-owned-media-deletion.executor';

interface PrivatePhotoDocument {
  path?: unknown;
  url?: unknown;
}

interface PhotoPublicationDocument {
  publishedStoragePath?: string | null;
}

interface PrivateVideoDocument {
  path?: unknown;
  url?: unknown;
  thumbnailPath?: unknown;
  thumbnailUrl?: unknown;
  processedOutputPrefix?: unknown;
}

interface VideoPublicationDocument {
  publishedStoragePath?: string | null;
  publishedPosterStoragePath?: string | null;
}

interface VideoProcessingDocument {
  ownerUid?: unknown;
  videoId?: unknown;
  state?: unknown;
  outputPrefix?: unknown;
}

const MAX_BATCH_WRITES = 450;
const TERMINAL_PROCESSING_STATES = new Set([
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
]);

const CLEANUP_COLLECTIONS: Readonly<Record<OwnedMediaCleanupJobKind, string>> = {
  photo_deletion: 'media_photo_deletion_jobs',
  video_deletion: 'media_video_deletion_jobs',
  published_photo_asset: 'media_published_asset_cleanup_jobs',
  published_video_asset: 'media_published_video_asset_cleanup_jobs',
};

export class FirestoreAccountDataDeletionOrchestratorAdapter
  extends FirestoreAccountDataDeletionAdapter
  implements AccountOwnedMediaDeletionAdapter
{
  async deleteOwnedPhotosPage(uid: string, limit: number): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('users')
      .doc(safeUid)
      .collection('photos')
      .limit(limit)
      .get();

    for (const photoSnapshot of snapshot.docs) {
      await this.deleteOwnedPhoto(safeUid, photoSnapshot);
    }

    return snapshot.size;
  }

  async deleteOwnedVideosPage(uid: string, limit: number): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('users')
      .doc(safeUid)
      .collection('videos')
      .limit(limit)
      .get();

    for (const videoSnapshot of snapshot.docs) {
      await this.deleteOwnedVideo(safeUid, videoSnapshot);
    }

    return snapshot.size;
  }

  async deleteOwnedPhotoPublicationsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('users')
      .doc(safeUid)
      .collection('photo_publications')
      .limit(limit)
      .get();

    for (const publicationSnapshot of snapshot.docs) {
      const photoId = publicationSnapshot.id;
      const publication = publicationSnapshot.data() as PhotoPublicationDocument;

      await deletePublishedPhotoAssetOrQueue({
        ownerUid: safeUid,
        photoId,
        storagePath: publication.publishedStoragePath,
        reason: 'account-deletion-orphan-photo-publication',
      });
      await Promise.all([
        publicationSnapshot.ref.delete(),
        db
          .doc(`public_profiles/${safeUid}/public_photos/${photoId}`)
          .delete()
          .catch(() => undefined),
      ]);
    }

    return snapshot.size;
  }

  async deleteOwnedVideoPublicationsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('users')
      .doc(safeUid)
      .collection('video_publications')
      .limit(limit)
      .get();

    for (const publicationSnapshot of snapshot.docs) {
      const videoId = publicationSnapshot.id;
      const publication = publicationSnapshot.data() as VideoPublicationDocument;

      await Promise.all([
        deletePublishedVideoAssetOrQueue({
          ownerUid: safeUid,
          videoId,
          storagePath: publication.publishedStoragePath,
          assetKind: 'video',
          reason: 'account-deletion-orphan-video-publication',
        }),
        deletePublishedVideoAssetOrQueue({
          ownerUid: safeUid,
          videoId,
          storagePath: publication.publishedPosterStoragePath,
          assetKind: 'poster',
          reason: 'account-deletion-orphan-video-poster',
        }),
      ]);
      await Promise.all([
        publicationSnapshot.ref.delete(),
        db
          .doc(`public_profiles/${safeUid}/public_videos/${videoId}`)
          .delete()
          .catch(() => undefined),
      ]);
    }

    return snapshot.size;
  }

  async deleteOwnedImageStatesPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('users')
      .doc(safeUid)
      .collection('imageStates')
      .limit(limit)
      .get();

    await deleteDocumentRefs(snapshot.docs.map((document) => document.ref));
    return snapshot.size;
  }

  async deleteOwnedPublicMediaProjection(uid: string): Promise<number> {
    const safeUid = requireUid(uid);
    const publicProfileRef = db.collection('public_profiles').doc(safeUid);

    await db.recursiveDelete(publicProfileRef);
    return 1;
  }

  async resolveOwnedVideoProcessingJobsPage(
    uid: string,
    limit: number
  ): Promise<OwnedVideoProcessingPageSummary> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .where('ownerUid', '==', safeUid)
      .limit(limit)
      .get();
    let processed = 0;
    let blocking = 0;

    for (const jobSnapshot of snapshot.docs) {
      const job = jobSnapshot.data() as VideoProcessingDocument;
      const videoId = normalizeId(job.videoId);
      const state = normalizeProcessingState(job.state);

      if (!videoId) {
        blocking += 1;
        continue;
      }

      if (TERMINAL_PROCESSING_STATES.has(state)) {
        const outputPrefix = normalizeOwnedProcessedVideoPrefix(
          safeUid,
          videoId,
          job.outputPrefix
        );

        if (outputPrefix) {
          await deleteStoragePrefix(outputPrefix);
        }

        await jobSnapshot.ref.delete();
        processed += 1;
        continue;
      }

      if (state !== 'CANCEL_REQUESTED') {
        await jobSnapshot.ref.set(
          {
            state: 'CANCEL_REQUESTED',
            cancelRequestedAt: Date.now(),
            leaseUntil: null,
            updatedAt: Date.now(),
            lastErrorCode: 'ACCOUNT_DELETION_REQUESTED',
            lastError: 'A conta proprietária entrou em exclusão definitiva.',
          },
          { merge: true }
        );
      }

      blocking += 1;
    }

    return {
      scanned: snapshot.size,
      processed,
      blocking,
    };
  }

  async deleteOwnedStorageObjectsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const [files] = await storage.bucket().getFiles({
      prefix: `users/${safeUid}/`,
      maxResults: limit,
      autoPaginate: false,
    });

    await Promise.all(
      files.map((file) => file.delete({ ignoreNotFound: true }))
    );
    return files.length;
  }

  async deleteOwnedMediaCleanupJobsPage(
    uid: string,
    kind: OwnedMediaCleanupJobKind,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const collectionName = CLEANUP_COLLECTIONS[kind];
    const snapshot = await db
      .collection(collectionName)
      .where('ownerUid', '==', safeUid)
      .limit(limit)
      .get();

    await deleteDocumentRefs(snapshot.docs.map((document) => document.ref));
    return snapshot.size;
  }

  private async deleteOwnedPhoto(
    uid: string,
    photoSnapshot: FirebaseFirestore.QueryDocumentSnapshot
  ): Promise<void> {
    const photoId = photoSnapshot.id;
    const privatePhoto = photoSnapshot.data() as PrivatePhotoDocument;
    const publicationRef = db.doc(
      `users/${uid}/photo_publications/${photoId}`
    );
    const publicPhotoRef = db.doc(
      `public_profiles/${uid}/public_photos/${photoId}`
    );
    const publicationSnapshot = await publicationRef.get();
    const publication = publicationSnapshot.exists
      ? (publicationSnapshot.data() as PhotoPublicationDocument)
      : null;
    const privateStoragePath =
      extractOwnedPrivatePhotoPath(uid, privatePhoto.path) ??
      extractOwnedPrivatePhotoPath(uid, privatePhoto.url);
    const hideBatch = db.batch();

    hideBatch.delete(publicationRef);
    hideBatch.delete(publicPhotoRef);
    await hideBatch.commit();

    await deletePublishedPhotoAssetOrQueue({
      ownerUid: uid,
      photoId,
      storagePath: publication?.publishedStoragePath,
      reason: 'account-deletion-photo',
    });

    if (privateStoragePath) {
      await storage
        .bucket()
        .file(privateStoragePath)
        .delete({ ignoreNotFound: true });
    }

    await db.recursiveDelete(photoSnapshot.ref);
  }

  private async deleteOwnedVideo(
    uid: string,
    videoSnapshot: FirebaseFirestore.QueryDocumentSnapshot
  ): Promise<void> {
    const videoId = videoSnapshot.id;
    const privateVideo = videoSnapshot.data() as PrivateVideoDocument;
    const publicationRef = db.doc(
      `users/${uid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${uid}/public_videos/${videoId}`
    );
    const processingRef = db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .doc(buildVideoProcessingJobId(uid, videoId));
    const [publicationSnapshot, processingSnapshot] = await Promise.all([
      publicationRef.get(),
      processingRef.get(),
    ]);
    const publication = publicationSnapshot.exists
      ? (publicationSnapshot.data() as VideoPublicationDocument)
      : null;
    const processing = processingSnapshot.exists
      ? (processingSnapshot.data() as VideoProcessingDocument)
      : null;
    const processingState = normalizeProcessingState(processing?.state);
    const activeProcessing =
      processingSnapshot.exists &&
      !TERMINAL_PROCESSING_STATES.has(processingState);
    const privateVideoPath =
      extractOwnedPrivateVideoPath(uid, privateVideo.path) ??
      extractOwnedPrivateVideoPath(uid, privateVideo.url);
    const privatePosterPath =
      extractOwnedPrivateVideoPosterPath(
        uid,
        videoId,
        privateVideo.thumbnailPath
      ) ??
      extractOwnedPrivateVideoPosterPath(
        uid,
        videoId,
        privateVideo.thumbnailUrl
      );
    const processedOutputPrefix =
      normalizeOwnedProcessedVideoPrefix(
        uid,
        videoId,
        privateVideo.processedOutputPrefix
      ) ??
      normalizeOwnedProcessedVideoPrefix(uid, videoId, processing?.outputPrefix);
    const hideBatch = db.batch();

    hideBatch.delete(publicationRef);
    hideBatch.delete(publicVideoRef);

    if (activeProcessing) {
      hideBatch.set(
        processingRef,
        {
          state: 'CANCEL_REQUESTED',
          cancelRequestedAt: Date.now(),
          leaseUntil: null,
          updatedAt: Date.now(),
          lastErrorCode: 'ACCOUNT_DELETION_REQUESTED',
          lastError: 'A conta proprietária entrou em exclusão definitiva.',
        },
        { merge: true }
      );
    }

    await hideBatch.commit();

    await Promise.all([
      deletePublishedVideoAssetOrQueue({
        ownerUid: uid,
        videoId,
        storagePath: publication?.publishedStoragePath,
        assetKind: 'video',
        reason: 'account-deletion-video',
      }),
      deletePublishedVideoAssetOrQueue({
        ownerUid: uid,
        videoId,
        storagePath: publication?.publishedPosterStoragePath,
        assetKind: 'poster',
        reason: 'account-deletion-video-poster',
      }),
    ]);

    const privateDeleteTasks: Promise<unknown>[] = [];

    if (privateVideoPath) {
      privateDeleteTasks.push(
        storage
          .bucket()
          .file(privateVideoPath)
          .delete({ ignoreNotFound: true })
      );
    }

    if (privatePosterPath) {
      privateDeleteTasks.push(
        storage
          .bucket()
          .file(privatePosterPath)
          .delete({ ignoreNotFound: true })
      );
    }

    await Promise.all(privateDeleteTasks);

    if (!activeProcessing && processedOutputPrefix) {
      await deleteStoragePrefix(processedOutputPrefix);
    }

    if (processingSnapshot.exists && !activeProcessing) {
      await processingRef.delete();
    }

    await Promise.all([
      db.recursiveDelete(videoSnapshot.ref),
      db.recursiveDelete(publicVideoRef),
    ]);
  }
}

function requireUid(value: unknown): string {
  const uid = normalizeId(value);

  if (!uid) {
    throw new Error('UID inválido para exclusão de mídia da conta.');
  }

  return uid;
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,128}$/.test(normalized) ? normalized : null;
}

function normalizeProcessingState(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

async function deleteStoragePrefix(prefix: string): Promise<void> {
  const [files] = await storage.bucket().getFiles({ prefix });

  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
}

async function deleteDocumentRefs(
  refs: readonly FirebaseFirestore.DocumentReference[]
): Promise<void> {
  for (let offset = 0; offset < refs.length; offset += MAX_BATCH_WRITES) {
    const batch = db.batch();
    const chunk = refs.slice(offset, offset + MAX_BATCH_WRITES);

    chunk.forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
}
