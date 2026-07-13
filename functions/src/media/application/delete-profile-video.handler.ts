import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import { deletePublishedVideoAssetOrQueue } from './published-video-asset.service';
import {
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
} from './video-processing-job';
import {
  extractOwnedPrivateVideoPath,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedProcessedVideoPrefix,
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
  processedOutputPrefix: string | null;
  publishedVideoStoragePath: string | null;
  publishedPosterStoragePath: string | null;
  processingCleanupPending: boolean;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

interface PrivateVideoDoc {
  path?: string;
  url?: string;
  thumbnailPath?: string;
  thumbnailUrl?: string;
  processedOutputPrefix?: string;
}

interface VideoPublicationDoc {
  publishedStoragePath?: string;
  publishedPosterStoragePath?: string;
}

interface VideoProcessingJobDoc {
  outputPrefix?: string;
  state?: string;
}

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

async function refreshMetricsBestEffort(ownerUid: string): Promise<void> {
  try {
    await refreshPublicProfileMediaMetrics(ownerUid);
  } catch (error) {
    logger.warn('[videoDeletion] Falha ao atualizar métricas derivadas.', {
      ownerUid,
      error: normalizeErrorMessage(error),
    });
  }
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

async function deleteProcessedAssets(job: VideoDeletionJob): Promise<void> {
  if (!job.processedOutputPrefix) {
    return;
  }

  const [files] = await storage.bucket().getFiles({
    prefix: job.processedOutputPrefix,
  });

  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
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

  await Promise.all([
    deletePrivateAssets(job),
    deleteProcessedAssets(job),
  ]);
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

function requestProcessingCancellation(
  batch: FirebaseFirestore.WriteBatch,
  processingJobRef: FirebaseFirestore.DocumentReference,
  processingJob: VideoProcessingJobDoc | null,
  now: number
): boolean {
  if (!processingJob) {
    return false;
  }

  const state = String(processingJob.state ?? '').trim().toUpperCase();

  if (state === 'CANCELLED' || state === 'CANCEL_REQUESTED') {
    return true;
  }

  batch.set(
    processingJobRef,
    {
      state: 'CANCEL_REQUESTED',
      cancelRequestedAt: now,
      leaseUntil: null,
      updatedAt: now,
      lastErrorCode: 'PRIVATE_VIDEO_DELETED',
      lastError: 'O vídeo privado foi excluído pelo proprietário.',
    },
    { merge: true }
  );

  return true;
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
    const processingJobRef = db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .doc(buildVideoProcessingJobId(ownerUid, videoId));
    const [privateVideoSnap, publicationSnap, processingJobSnap] =
      await Promise.all([
        privateVideoRef.get(),
        publicationRef.get(),
        processingJobRef.get(),
      ]);
    const publication = publicationSnap.exists
      ? (publicationSnap.data() as VideoPublicationDoc)
      : null;
    const processingJob = processingJobSnap.exists
      ? (processingJobSnap.data() as VideoProcessingJobDoc)
      : null;
    const now = Date.now();

    if (!privateVideoSnap.exists) {
      const cleanupBatch = db.batch();
      cleanupBatch.delete(publicationRef);
      cleanupBatch.delete(publicVideoRef);
      const processingCleanupPending = requestProcessingCancellation(
        cleanupBatch,
        processingJobRef,
        processingJob,
        now
      );
      await cleanupBatch.commit();
      await refreshMetricsBestEffort(ownerUid);

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
        cleanupPending:
          !publishedAssetsDeleted || processingCleanupPending,
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
    const processedOutputPrefix =
      normalizeOwnedProcessedVideoPrefix(
        ownerUid,
        videoId,
        privateVideo.processedOutputPrefix
      ) ??
      normalizeOwnedProcessedVideoPrefix(
        ownerUid,
        videoId,
        processingJob?.outputPrefix
      );
    const jobId = buildDeletionJobId(ownerUid, videoId);
    const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);
    const hideBatch = db.batch();
    const processingCleanupPending = requestProcessingCancellation(
      hideBatch,
      processingJobRef,
      processingJob,
      now
    );
    const job: VideoDeletionJob = {
      ownerUid,
      videoId,
      privateVideoStoragePath,
      privatePosterStoragePath,
      processedOutputPrefix,
      publishedVideoStoragePath:
        publication?.publishedStoragePath ?? null,
      publishedPosterStoragePath:
        publication?.publishedPosterStoragePath ?? null,
      processingCleanupPending,
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      lastError: null,
    };

    hideBatch.set(jobRef, job);
    hideBatch.delete(publicationRef);
    hideBatch.delete(publicVideoRef);
    await hideBatch.commit();
    await refreshMetricsBestEffort(ownerUid);

    try {
      const publishedAssetsDeleted = await executeDeletionJob(jobId, job);

      return {
        videoId,
        cleanupPending:
          !publishedAssetsDeleted || processingCleanupPending,
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
      const processedOutputPrefix = job.processedOutputPrefix
        ? normalizeOwnedProcessedVideoPrefix(
          ownerUid,
          videoId,
          job.processedOutputPrefix
        )
        : null;

      if (
        !ownerUid ||
        !videoId ||
        !privateVideoStoragePath ||
        (job.privatePosterStoragePath && !privatePosterStoragePath) ||
        (job.processedOutputPrefix && !processedOutputPrefix)
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
          processedOutputPrefix,
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
