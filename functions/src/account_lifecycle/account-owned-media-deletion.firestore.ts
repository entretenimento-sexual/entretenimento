// functions/src/account_lifecycle/account-owned-media-deletion.firestore.ts
// -----------------------------------------------------------------------------
// FIREBASE ADAPTER FOR OWNED MEDIA AND STORAGE DELETION
// -----------------------------------------------------------------------------
// O escopo é deliberadamente restrito ao namespace e aos metadados de mídia do
// próprio usuário. Mensagens, denúncias, evidências e registros financeiros não
// são tocados por este adaptador.
// -----------------------------------------------------------------------------
import { randomUUID } from 'node:crypto';

import { db, storage } from '../firebaseApp';
import { deletePublishedPhotoAssetOrQueue } from '../media/application/published-photo-asset.service';
import { deleteProfilePhotoResources } from '../media/application/delete-profile-photo.handler';
import { deleteProfileVideoResources } from '../media/application/delete-profile-video.handler';
import {
  deleteGenerationPinnedVideoFile,
  deleteVideoStoragePrefixBounded,
} from '../media/application/video-deletion-storage-pages';
import { deletePublishedVideoAssetOrQueue } from '../media/application/published-video-asset.service';
import {
  VIDEO_PROCESSING_JOBS_COLLECTION, type VideoProcessingJob,
} from '../media/application/video-processing-job';
import { withAdminTriageProjection }
  from '../media/application/admin-video-triage.firestore';
import { stageVideoTriageMutationInTransaction }
  from '../media/application/admin-video-triage-mutation-outbox.firestore';
import {
  normalizeOwnedProcessedVideoPrefix,
} from '../media/application/video-storage-path';
import { FirestoreAccountDataDeletionAdapter } from './account-data-deletion.firestore';
import type {
  AccountOwnedMediaDeletionAdapter,
  OwnedMediaCleanupJobKind,
  OwnedVideoProcessingPageSummary,
} from './account-owned-media-deletion.executor';

interface PhotoPublicationDocument {
  publishedStoragePath?: string | null;
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

        const eventId = randomUUID();
        const deleted = await db.runTransaction(async transaction => {
          const current = await transaction.get(jobSnapshot.ref);
          if (!current.exists || !current.updateTime ||
              !current.updateTime.isEqual(jobSnapshot.updateTime) ||
              current.get('ownerUid') !== safeUid ||
              !TERMINAL_PROCESSING_STATES.has(
                normalizeProcessingState(current.get('state')))) {
            return false;
          }
          stageVideoTriageMutationInTransaction(
            db, transaction, jobSnapshot.ref, {
              eventId, source: 'ACCOUNT_DELETION_PAGE', kind: 'DELETE',
              before: current, afterState: null,
            });
          transaction.delete(jobSnapshot.ref);
          return true;
        }, { maxAttempts: 2 });
        if (deleted) processed += 1;
        else blocking += 1;
        continue;
      }

      if (state !== 'CANCEL_REQUESTED') {
        const eventId = randomUUID();
        await db.runTransaction(async transaction => {
          const current = await transaction.get(jobSnapshot.ref);
          if (!current.exists || current.get('ownerUid') !== safeUid ||
              TERMINAL_PROCESSING_STATES.has(
                normalizeProcessingState(current.get('state'))) ||
              normalizeProcessingState(current.get('state')) ===
                'CANCEL_REQUESTED') return;
          const now = Date.now();
          const patch = {
            state: 'CANCEL_REQUESTED' as const,
            cancelRequestedAt: now, leaseUntil: null,
            updatedAt: now,
            lastErrorCode: 'ACCOUNT_DELETION_REQUESTED',
            lastError: 'A conta proprietária entrou em exclusão definitiva.',
          };
          transaction.update(jobSnapshot.ref, withAdminTriageProjection(
            jobSnapshot.id, current.data() as Partial<VideoProcessingJob>,
            patch, now));
          stageVideoTriageMutationInTransaction(
            db, transaction, jobSnapshot.ref, {
              eventId, source: 'ACCOUNT_DELETION_PAGE',
              kind: 'CANCEL_REQUESTED', before: current,
              afterState: 'CANCEL_REQUESTED',
            });
        }, { maxAttempts: 2 });
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

    await Promise.all(files.map(file =>
      deleteGenerationPinnedVideoFile(file.metadata?.generation, generation =>
        file.delete({ ignoreNotFound: true, ifGenerationMatch: generation })
      )
    ));
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
    // The canonical flow stages publication cleanup in the same transaction
    // as visibility removal, pins the private GCS generation and retains its
    // durable recovery obligation. Account deletion must not bypass it.
    const result = await deleteProfilePhotoResources(uid, photoSnapshot.id, {
      allowQuarantined: true,
    });
    if (result.cleanupPending) {
      // Retry the account deletion page after the scheduler reconciles jobs.
      // Never acknowledge metadata removal while Storage cleanup is pending.
      throw new Error('Owned photo cleanup pending; account deletion requires retry.');
    }
  }

  private async deleteOwnedVideo(
    uid: string,
    videoSnapshot: FirebaseFirestore.QueryDocumentSnapshot
  ): Promise<void> {
    // The canonical transaction owns tombstones, processing cancellation,
    // published asset cleanup and generation-pinned private deletion.
    const result = await deleteProfileVideoResources(uid, videoSnapshot.id, {
      allowQuarantined: true,
    });
    if (result.cleanupPending) {
      throw new Error('Owned video cleanup pending; account deletion requires retry.');
    }
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

async function deleteExactOwnedMediaObject(path: string): Promise<void> {
  const file = storage.bucket().file(path);
  try {
    const [metadata] = await file.getMetadata();
    await deleteGenerationPinnedVideoFile(metadata.generation, generation =>
      file.delete({ ignoreNotFound: true, ifGenerationMatch: generation })
    );
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? Number((error as { code: unknown }).code) : null;
    if (code === 404) return;
    throw error;
  }
}

async function deleteStoragePrefix(prefix: string): Promise<void> {
  // Bounded version-specific pages; never sweep other processing versions.
  await deleteVideoStoragePrefixBounded(prefix, async (pagePrefix, limit) => {
    const [files] = await storage.bucket().getFiles({
      prefix: pagePrefix, maxResults: limit, autoPaginate: false,
    });
    return files.map(file => ({
      delete: () => deleteGenerationPinnedVideoFile(
        file.metadata?.generation,
        generation => file.delete({
          ignoreNotFound: true, ifGenerationMatch: generation,
        })
      ),
    }));
  });
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
