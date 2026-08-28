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
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedProcessedVideoPrefix,
} from './video-storage-path';

interface DeleteProfileVideoRequest {
  ownerUid?: string;
  videoId?: string;
}

export interface DeleteProfileVideoResponse {
  videoId: string;
  cleanupPending: boolean;
}

export interface DeleteProfileVideoResourcesOptions {
  allowQuarantined?: boolean;
}

interface VideoDeletionJob {
  ownerUid: string;
  videoId: string;
  privateVideoStoragePath: string | null;
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
  moderationStatus?: string;
}

interface VideoProcessingJobDoc {
  sourceStoragePath?: string;
  sourcePosterStoragePath?: string | null;
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

function isQuarantinedPublication(
  publication: VideoPublicationDoc | null
): boolean {
  return String(publication?.moderationStatus ?? '')
    .trim()
    .toUpperCase() === 'FLAGGED';
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

function privateVideoPrefix(ownerUid: string, videoId: string): string {
  return `users/${ownerUid}/uploads/videos/${videoId}-`;
}

function privatePosterPrefix(ownerUid: string, videoId: string): string {
  return `users/${ownerUid}/uploads/video-posters/${videoId}/`;
}

function processedVideoPrefix(ownerUid: string, videoId: string): string {
  return `users/${ownerUid}/processed/videos/${videoId}/`;
}

function publishedVideoPrefix(ownerUid: string, videoId: string): string {
  return `users/${ownerUid}/published/videos/${videoId}/`;
}

async function deleteFilesByPrefix(prefix: string): Promise<void> {
  const [files] = await storage.bucket().getFiles({ prefix });

  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
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
  const exactDeleteTasks: Promise<unknown>[] = [];

  if (job.privateVideoStoragePath) {
    exactDeleteTasks.push(
      bucket
        .file(job.privateVideoStoragePath)
        .delete({ ignoreNotFound: true })
    );
  }

  if (job.privatePosterStoragePath) {
    exactDeleteTasks.push(
      bucket
        .file(job.privatePosterStoragePath)
        .delete({ ignoreNotFound: true })
    );
  }

  await Promise.all([
    ...exactDeleteTasks,
    deleteFilesByPrefix(privateVideoPrefix(job.ownerUid, job.videoId)),
    deleteFilesByPrefix(privatePosterPrefix(job.ownerUid, job.videoId)),
  ]);
}

async function deleteProcessedAssets(job: VideoDeletionJob): Promise<void> {
  await deleteFilesByPrefix(processedVideoPrefix(job.ownerUid, job.videoId));
}

async function deletePublishedAssetsByPrefix(
  job: VideoDeletionJob
): Promise<void> {
  await deleteFilesByPrefix(publishedVideoPrefix(job.ownerUid, job.videoId));
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
    deletePublishedAssetsByPrefix(job),
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
      lastErrorCode: 'VIDEO_DELETED',
      lastError: 'O vídeo foi excluído da plataforma.',
    },
    { merge: true }
  );

  return true;
}

/**
 * Exclusão canônica de um vídeo do produto.
 *
 * Remove metadados privados, projeção pública, interações, fonte, capa,
 * derivados e ativos publicados. Jobs técnicos só sobrevivem enquanto forem
 * necessários para cancelar/terminar a limpeza física e depois são removidos.
 * Evidências de moderação ficam fora deste agregado e seguem sua própria
 * política de retenção/pseudonimização.
 *
 * `allowQuarantined` é reservado à moderação depois da preservação probatória.
 * A exclusão do proprietário permanece fail-closed enquanto FLAGGED.
 */
export async function deleteProfileVideoResources(
  ownerUidValue: unknown,
  videoIdValue: unknown,
  options: DeleteProfileVideoResourcesOptions = {}
): Promise<DeleteProfileVideoResponse> {
  const ownerUid = cleanId(ownerUidValue);
  const videoId = cleanId(videoIdValue);

  if (!ownerUid || !videoId) {
    throw new HttpsError('invalid-argument', 'Vídeo inválido.');
  }

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
  const privateVideo = privateVideoSnap.exists
    ? (privateVideoSnap.data() as PrivateVideoDoc)
    : null;
  const publication = publicationSnap.exists
    ? (publicationSnap.data() as VideoPublicationDoc)
    : null;
  const processingJob = processingJobSnap.exists
    ? (processingJobSnap.data() as VideoProcessingJobDoc)
    : null;

  if (isQuarantinedPublication(publication) && options.allowQuarantined !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Este vídeo está temporariamente preservado durante uma análise de segurança.'
    );
  }

  const now = Date.now();
  const privateVideoStoragePath =
    extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      privateVideo?.path
    ) ??
    extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      privateVideo?.url
    ) ??
    extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      processingJob?.sourceStoragePath
    );
  const privatePosterStoragePath =
    extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      privateVideo?.thumbnailPath
    ) ??
    extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      privateVideo?.thumbnailUrl
    ) ??
    extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      processingJob?.sourcePosterStoragePath
    );
  const processedOutputPrefix =
    normalizeOwnedProcessedVideoPrefix(
      ownerUid,
      videoId,
      privateVideo?.processedOutputPrefix
    ) ??
    normalizeOwnedProcessedVideoPrefix(
      ownerUid,
      videoId,
      processingJob?.outputPrefix
    );
  const jobId = buildDeletionJobId(ownerUid, videoId);
  const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);
  const removalBatch = db.batch();
  const processingCleanupPending = requestProcessingCancellation(
    removalBatch,
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

  removalBatch.set(jobRef, job);
  if (publicationSnap.exists && publicationSnap.updateTime) {
    removalBatch.delete(publicationRef, {
      lastUpdateTime: publicationSnap.updateTime,
    });
  } else {
    removalBatch.delete(publicationRef);
  }
  removalBatch.delete(publicVideoRef);
  await removalBatch.commit();
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
    return deleteProfileVideoResources(ownerUid, videoId);
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

      if (!ownerUid || !videoId) {
        logger.error('[cleanupPendingVideoDeletions] Job inválido.', {
          jobId: jobDoc.id,
        });
        continue;
      }

      const privateVideoStoragePath = job.privateVideoStoragePath
        ? extractOwnedPrivateVideoPathForId(
          ownerUid,
          videoId,
          job.privateVideoStoragePath
        )
        : null;
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

      if (job.privateVideoStoragePath && !privateVideoStoragePath) {
        logger.warn(
          '[cleanupPendingVideoDeletions] Path privado inválido; usando prefixo canônico.',
          { jobId: jobDoc.id, ownerUid, videoId }
        );
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