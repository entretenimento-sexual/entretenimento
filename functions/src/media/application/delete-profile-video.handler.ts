import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import { deletePublishedVideoAssetOrQueue } from './published-video-asset.service';
import {
  extractOwnedPrivateVideoPath,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

interface DeleteProfileVideoRequest {
  ownerUid?: string;
  videoId?: string;
}

interface DeleteProfileVideoResponse {
  videoId: string;
  cleanupPending: boolean;
}

interface VideoDeletionJob {
  ownerUid: string;
  videoId: string;
  privateVideoStoragePath: string;
  privatePosterStoragePath: string | null;
  publishedVideoStoragePath: string | null;
  publishedPosterStoragePath: string | null;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

type PrivateVideoDoc = {
  path?: string;
  url?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
};

type VideoPublicationDoc = {
  publishedStoragePath?: string;
  publishedPosterStoragePath?: string;
};

const DELETION_JOBS_COLLECTION = 'media_video_deletion_jobs';
const CLEANUP_BATCH_SIZE = 50;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    containsControlCharacter(normalized)
  ) {
    return '';
  }

  return normalized;
}

function assertOwner(requesterUid: string | null, ownerUid: string): void {
  if (!requesterUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (requesterUid !== ownerUid) {
    throw new HttpsError(
      'permission-denied',
      'Você só pode excluir vídeos do seu próprio perfil.'
    );
  }
}

function buildDeletionJobId(ownerUid: string, videoId: string): string {
  return `${ownerUid}_${videoId}`;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

async function cleanupPublishedAssets(
  job: Pick<
    VideoDeletionJob,
    | 'ownerUid'
    | 'videoId'
    | 'publishedVideoStoragePath'
    | 'publishedPosterStoragePath'
  >
): Promise<boolean> {
  const [videoDeleted, posterDeleted] = await Promise.all([
    deletePublishedVideoAssetOrQueue({
      ownerUid: job.ownerUid,
      videoId: job.videoId,
      storagePath: job.publishedVideoStoragePath,
      assetKind: 'video',
      reason: 'delete-profile-video',
    }),
    deletePublishedVideoAssetOrQueue({
      ownerUid: job.ownerUid,
      videoId: job.videoId,
      storagePath: job.publishedPosterStoragePath,
      assetKind: 'poster',
      reason: 'delete-profile-video-poster',
    }),
  ]);

  return videoDeleted && posterDeleted;
}

async function deletePrivateAssets(job: VideoDeletionJob): Promise<void> {
  const bucket = storage.bucket();
  const deleteTasks: Promise<unknown>[] = [
    bucket
      .file(job.privateVideoStoragePath)
      .delete({ ignoreNotFound: true }),
  ];

  if (job.privatePosterStoragePath) {
    deleteTasks.push(
      bucket
        .file(job.privatePosterStoragePath)
        .delete({ ignoreNotFound: true })
    );
  }

  await Promise.all(deleteTasks);
}

async function executeDeletionJob(
  jobId: string,
  job: VideoDeletionJob
): Promise<boolean> {
  const privateVideoRef = db.doc(
    `users/${job.ownerUid}/videos/${job.videoId}`
  );
  const publicVideoRef = db.doc(
    `public_profiles/${job.ownerUid}/public_videos/${job.videoId}`
  );
  const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);

  await deletePrivateAssets(job);
  const publishedAssetsDeleted = await cleanupPublishedAssets(job);

  await Promise.all([
    db.recursiveDelete(privateVideoRef),
    db.recursiveDelete(publicVideoRef),
  ]);
  await jobRef.delete();

  return publishedAssetsDeleted;
}

async function recordDeletionAttemptFailure(
  jobId: string,
  error: unknown
): Promise<void> {
  const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);

  try {
    await jobRef.update({
      attempts: FieldValue.increment(1),
      updatedAt: Date.now(),
      lastError: normalizeErrorMessage(error),
    });
  } catch (updateError) {
    logger.warn('[videoDeletion] Job indisponível para atualização.', {
      jobId,
      error: normalizeErrorMessage(updateError),
    });
  }
}

export const deleteProfileVideo = onCall<DeleteProfileVideoRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<DeleteProfileVideoResponse> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    assertOwner(requesterUid, ownerUid);

    const privateVideoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const [privateVideoSnap, publicationSnap] = await Promise.all([
      privateVideoRef.get(),
      publicationRef.get(),
    ]);
    const publication = publicationSnap.exists
      ? (publicationSnap.data() as VideoPublicationDoc)
      : null;

    if (!privateVideoSnap.exists) {
      const now = Date.now();
      const cleanupBatch = db.batch();
      cleanupBatch.delete(publicationRef);
      cleanupBatch.set(
        publicVideoRef,
        {
          visibility: 'PRIVATE',
          moderationStatus: 'HIDDEN',
          updatedAt: now,
        },
        { merge: true }
      );
      await cleanupBatch.commit();
      await refreshPublicProfileMediaMetrics(ownerUid);

      const publishedAssetsDeleted = await cleanupPublishedAssets({
        ownerUid,
        videoId,
        publishedVideoStoragePath:
          publication?.publishedStoragePath ?? null,
        publishedPosterStoragePath:
          publication?.publishedPosterStoragePath ?? null,
      });
      await db.recursiveDelete(publicVideoRef);

      return {
        videoId,
        cleanupPending: !publishedAssetsDeleted,
      };
    }

    const privateVideo = privateVideoSnap.data() as PrivateVideoDoc;
    const privateVideoStoragePath =
      extractOwnedPrivateVideoPath(ownerUid, privateVideo.path) ??
      extractOwnedPrivateVideoPath(ownerUid, privateVideo.url);

    if (!privateVideoStoragePath) {
      throw new HttpsError(
        'failed-precondition',
        'O vídeo não possui um caminho privado válido para exclusão.'
      );
    }

    const privatePosterStoragePath =
      extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        privateVideo.thumbnailPath
      ) ??
      extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        privateVideo.thumbnailUrl
      );
    const now = Date.now();
    const jobId = buildDeletionJobId(ownerUid, videoId);
    const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);
    const job: VideoDeletionJob = {
      ownerUid,
      videoId,
      privateVideoStoragePath,
      privatePosterStoragePath,
      publishedVideoStoragePath:
        publication?.publishedStoragePath ?? null,
      publishedPosterStoragePath:
        publication?.publishedPosterStoragePath ?? null,
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      lastError: null,
    };

    const hideBatch = db.batch();
    hideBatch.set(jobRef, job);
    hideBatch.delete(publicationRef);
    hideBatch.set(
      publicVideoRef,
      {
        visibility: 'PRIVATE',
        moderationStatus: 'HIDDEN',
        updatedAt: now,
      },
      { merge: true }
    );
    await hideBatch.commit();
    await refreshPublicProfileMediaMetrics(ownerUid);

    try {
      const publishedAssetsDeleted = await executeDeletionJob(jobId, job);

      return {
        videoId,
        cleanupPending: !publishedAssetsDeleted,
      };
    } catch (error) {
      await recordDeletionAttemptFailure(jobId, error);

      logger.error('[deleteProfileVideo] Limpeza física pendente.', {
        ownerUid,
        videoId,
        jobId,
        error: normalizeErrorMessage(error),
      });

      return {
        videoId,
        cleanupPending: true,
      };
    }
  }
);

export const cleanupPendingVideoDeletions = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const jobsSnapshot = await db
      .collection(DELETION_JOBS_COLLECTION)
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    for (const jobDoc of jobsSnapshot.docs) {
      const job = jobDoc.data() as VideoDeletionJob;
      const ownerUid = cleanId(job.ownerUid);
      const videoId = cleanId(job.videoId);
      const privateVideoStoragePath = extractOwnedPrivateVideoPath(
        ownerUid,
        job.privateVideoStoragePath
      );
      const privatePosterStoragePath = job.privatePosterStoragePath
        ? extractOwnedPrivateVideoPosterPath(
          ownerUid,
          videoId,
          job.privatePosterStoragePath
        )
        : null;

      if (
        !ownerUid ||
        !videoId ||
        !privateVideoStoragePath ||
        (job.privatePosterStoragePath && !privatePosterStoragePath)
      ) {
        logger.error('[cleanupPendingVideoDeletions] Job inválido.', {
          jobId: jobDoc.id,
        });
        continue;
      }

      try {
        await executeDeletionJob(jobDoc.id, {
          ...job,
          ownerUid,
          videoId,
          privateVideoStoragePath,
          privatePosterStoragePath,
        });
      } catch (error) {
        await recordDeletionAttemptFailure(jobDoc.id, error);

        logger.error('[cleanupPendingVideoDeletions] Falha no retry.', {
          jobId: jobDoc.id,
          ownerUid,
          videoId,
          error: normalizeErrorMessage(error),
        });
      }
    }
  }
);
