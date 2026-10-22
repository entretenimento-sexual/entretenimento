import { randomUUID } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  deleteGenerationPinnedVideoFile,
  deleteVideoStoragePrefixBounded,
  normalizeGcsGeneration,
  VideoDeletionGenerationConflictError,
} from './video-deletion-storage-pages';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import { claimVideoDeletionJob, settleVideoDeletionJob } from './video-deletion-queue.firestore';
import { processPendingVideoOriginalCleanupJobs } from './cleanup-published-video-originals.handler';
import {
  retireVideoIdentityForActiveClaim,
} from './video-identity-guard.firestore';
import { migrateLegacyPublishedVideoCleanupJobs } from './published-video-cleanup-migration.firestore';
import { deletePublishedVideoAssetOrQueueWithResult } from './published-video-asset.service';
import { decidePublishedVideoDeletionPath } from './published-video-storage-mode.policy';
import {
  summarizePublishedAssetCleanupResults,
  type PublishedAssetsSummary,
} from './video-deletion-published-cleanup.policy';
import {
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
import { commitProfileVideoDeletionRequest }
  from './video-profile-deletion-commit.firestore';
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
  /** Generation captured when the deletion request was staged. */
  privateVideoStorageGeneration?: string | null;
  privatePosterStorageGeneration?: string | null;
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
  isPublished?: boolean;
  publishedStoragePath?: string;
  publishedPosterStoragePath?: string;
  moderationStatus?: string;
  reviewEvidenceRetention?: string;
}

type VideoProcessingJobDoc = Partial<VideoProcessingJob>;

const DELETION_JOBS_COLLECTION = 'media_video_deletion_jobs';
const CLEANUP_BATCH_SIZE = 50;
const VIDEO_DELETE_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 10,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 40,
});

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

function resolvePrivateDeletionPaths(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDoc | null,
  processing: VideoProcessingJobDoc | null
): Pick<VideoDeletionJob, 'privateVideoStoragePath' | 'privatePosterStoragePath'> {
  return {
    privateVideoStoragePath:
      extractOwnedPrivateVideoPathForId(ownerUid, videoId, video?.path) ??
      extractOwnedPrivateVideoPathForId(ownerUid, videoId, video?.url) ??
      extractOwnedPrivateVideoPathForId(ownerUid, videoId, processing?.sourceStoragePath),
    privatePosterStoragePath:
      extractOwnedPrivateVideoPosterPath(ownerUid, videoId, video?.thumbnailPath) ??
      extractOwnedPrivateVideoPosterPath(ownerUid, videoId, video?.thumbnailUrl) ??
      extractOwnedPrivateVideoPosterPath(ownerUid, videoId, processing?.sourcePosterStoragePath),
  };
}

/** An absent object is distinguished from an unknown/unpinned legacy job. */
async function capturePrivateVideoGeneration(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const [metadata] = await storage.bucket().file(path).getMetadata();
    const generation = normalizeGcsGeneration(metadata.generation);
    if (!generation) {
      throw new VideoDeletionGenerationConflictError(
        'Missing private video generation; manual review required.'
      );
    }
    return generation;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code: unknown }).code : null;
    if (code === 404 || code === '404') return 'absent';
    throw error;
  }
}

/** Never rediscover the generation of an object from a previously staged job. */
async function deletePinnedPrivateVideoAsset(
  path: string | null,
  recordedGeneration: string | null | undefined
): Promise<void> {
  if (!path) {
    if (recordedGeneration !== null && recordedGeneration !== undefined) {
      throw new VideoDeletionGenerationConflictError(
        'Private video deletion path/generation mismatch; manual review required.'
      );
    }
    return;
  }
  const file = storage.bucket().file(path);
  if (recordedGeneration === 'absent') {
    const [exists] = await file.exists();
    if (exists) {
      throw new VideoDeletionGenerationConflictError(
        'Previously absent private video asset now exists; manual review required.'
      );
    }
    return;
  }
  await deleteGenerationPinnedVideoFile(recordedGeneration, (generation) =>
    file.delete({ ignoreNotFound: true, ifGenerationMatch: generation })
  );
}

async function deleteFilesByPrefix(prefix: string): Promise<void> {
  await deleteVideoStoragePrefixBounded(prefix, async (pagePrefix, limit) => {
    const [files] = await storage.bucket().getFiles({
      prefix: pagePrefix,
      maxResults: limit,
      autoPaginate: false,
    });
    return files.map((file) => ({
      // getFiles returns the generation for the object listed on this page.
      // Never delete a different generation that took its place meanwhile.
      delete: () => deleteGenerationPinnedVideoFile(
        file.metadata?.generation,
        (generation) => file.delete({
          ignoreNotFound: true,
          ifGenerationMatch: generation,
        })
      ),
    }));
  });
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
    | 'processedOutputPrefix'
  >
): Promise<PublishedAssetsSummary> {
  const publishedDecision = decidePublishedVideoDeletionPath(
    job.ownerUid, job.videoId, job.publishedVideoStoragePath,
    job.processedOutputPrefix
  );
  const [videoResult, posterResult] = await Promise.all([
    publishedDecision === 'HANDLED_BY_PROCESSED_PREFIX'
      ? Promise.resolve('DELETED' as const)
      : publishedDecision === 'BLOCKED'
        ? Promise.resolve('INVALID_PATH' as const)
        :
        deletePublishedVideoAssetOrQueueWithResult({
          ownerUid: job.ownerUid,
          videoId: job.videoId,
          storagePath: job.publishedVideoStoragePath,
          assetKind: 'video',
          reason: 'delete-profile-video',
        }),
    deletePublishedVideoAssetOrQueueWithResult({
      ownerUid: job.ownerUid,
      videoId: job.videoId,
      storagePath: job.publishedPosterStoragePath,
      assetKind: 'poster',
      reason: 'delete-profile-video-poster',
    }),
  ]);

  return summarizePublishedAssetCleanupResults(videoResult, posterResult);
}

async function deletePrivateAssets(job: VideoDeletionJob): Promise<void> {
  // Exact owned paths and pinned generations: never use prefix sweeps for private media.
  await Promise.all([
    deletePinnedPrivateVideoAsset(
      job.privateVideoStoragePath, job.privateVideoStorageGeneration
    ),
    deletePinnedPrivateVideoAsset(
      job.privatePosterStoragePath, job.privatePosterStorageGeneration
    ),
  ]);
}

async function deleteProcessedAssets(job: VideoDeletionJob): Promise<void> {
  // Never sweep every processing generation of a videoId. Missing or legacy
  // versions need reconciliation, not a broad destructive fallback.
  if (!job.processedOutputPrefix) return;
  await deleteFilesByPrefix(job.processedOutputPrefix);
}

async function executeDeletionJob(job: VideoDeletionJob): Promise<boolean> {
  const privateVideoRef = db.doc(
    `users/${job.ownerUid}/videos/${job.videoId}`
  );
  const publicVideoRef = db.doc(
    `public_profiles/${job.ownerUid}/public_videos/${job.videoId}`
  );
  const publishedOutcome = await cleanupPublishedAssets(job);
  if (publishedOutcome === 'BLOCKED') {
    // Keep the parent job and private assets until a safe decision is possible.
    throw new Error('Published video asset cleanup blocked; manual review required.');
  }

  await Promise.all([
    deletePrivateAssets(job),
    deleteProcessedAssets(job),
  ]);

  await Promise.all([
    db.recursiveDelete(privateVideoRef),
    db.recursiveDelete(publicVideoRef),
  ]);
  // The caller settles the lease transactionally after this work finishes.
  return publishedOutcome === 'QUEUED_FOR_RETRY';
}

/** Single entrypoint for immediate and scheduled physical cleanup. */
async function processVideoDeletionJob(
  jobRef: FirebaseFirestore.DocumentReference
): Promise<boolean> {
  const token = randomUUID();
  const raw = await claimVideoDeletionJob<VideoDeletionJob>(
    db, jobRef, Date.now(), token
  );
  if (!raw) return true;

  const ownerUid = cleanId(raw.ownerUid);
  const videoId = cleanId(raw.videoId);
  if (!ownerUid || !videoId ||
      buildDeletionJobId(ownerUid, videoId) !== jobRef.id) {
    await settleVideoDeletionJob(db, jobRef, token, {
      kind: 'BLOCKED', error: 'Invalid deletion job identity.',
    });
    logger.error('[videoDeletion] Job retido para revisao.', { jobId: jobRef.id });
    return true;
  }

  const job: VideoDeletionJob = {
    ...raw,
    ownerUid,
    videoId,
    privateVideoStoragePath: raw.privateVideoStoragePath
      ? extractOwnedPrivateVideoPathForId(ownerUid, videoId, raw.privateVideoStoragePath)
      : null,
    privatePosterStoragePath: raw.privatePosterStoragePath
      ? extractOwnedPrivateVideoPosterPath(ownerUid, videoId, raw.privatePosterStoragePath)
      : null,
    processedOutputPrefix: raw.processedOutputPrefix
      ? normalizeOwnedProcessedVideoPrefix(ownerUid, videoId, raw.processedOutputPrefix)
      : null,
  };

  try {
    // Legacy deletion jobs did not create identity tombstones at request time.
    // Backfill one under the current lease BEFORE any destructive operation.
    const identity = await retireVideoIdentityForActiveClaim(
      db, jobRef, token, ownerUid, videoId, Date.now()
    );
    if (identity === 'STALE') return true;
    if (identity === 'CONFLICT') {
      await settleVideoDeletionJob(db, jobRef, token, {
        kind: 'BLOCKED', error: 'Registered identity conflicts with legacy deletion job.',
      });
      return true;
    }
    if ((raw.privateVideoStoragePath && !job.privateVideoStoragePath) ||
        (raw.privatePosterStoragePath && !job.privatePosterStoragePath)) {
      throw new VideoDeletionGenerationConflictError(
        'Invalid private video cleanup path; manual review required.'
      );
    }
    // Legacy jobs without a pinned generation are retained for review.
    // Check BEFORE any published or processed asset is deleted.
    for (const [path, generation] of [
      [job.privateVideoStoragePath, job.privateVideoStorageGeneration],
      [job.privatePosterStoragePath, job.privatePosterStorageGeneration],
    ] as const) {
      if (path && generation !== 'absent' && !normalizeGcsGeneration(generation)) {
        throw new VideoDeletionGenerationConflictError(
          'Unpinned private video deletion; manual review required.'
        );
      }
    }
    const cleanupPending = await executeDeletionJob(job);
    const completion = await settleVideoDeletionJob(
      db, jobRef, token, { kind: 'COMPLETED' }
    );
    return cleanupPending || completion !== 'REMOVED';
  } catch (error) {
    const detail = normalizeErrorMessage(error);
    const blocked = error instanceof VideoDeletionGenerationConflictError ||
      detail === 'Published video asset cleanup blocked; manual review required.';
    const settlement = await settleVideoDeletionJob(db, jobRef, token,
      blocked ? { kind: 'BLOCKED', error: detail } :
        { kind: 'RETRYABLE_FAILURE', error: detail }
    );
    logger.error('[videoDeletion] Limpeza pendente.', {
      jobId: jobRef.id, status: settlement, reason: blocked ? 'BLOCKED' : 'RETRY',
    });
    return true;
  }
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
  const identityRef = db.doc(
    `users/${ownerUid}/video_identity_guards/${videoId}`
  );
  const now = Date.now();
  const jobId = buildDeletionJobId(ownerUid, videoId);
  const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);
  // Reused by Firestore on retries; only committed mutations stage an event.
  const eventId = randomUUID();
  // Read Storage OUTSIDE the transaction. Transactional buildJob revalidates
  // the paths so a changed Firestore source cannot inherit stale generations.
  const [preflightVideo, preflightProcessing] = await Promise.all([
    privateVideoRef.get(), processingJobRef.get(),
  ]);
  const preflightPaths = resolvePrivateDeletionPaths(
    ownerUid,
    videoId,
    preflightVideo.exists ? preflightVideo.data() as PrivateVideoDoc : null,
    preflightProcessing.exists
      ? preflightProcessing.data() as VideoProcessingJobDoc : null
  );
  const [privateVideoStorageGeneration, privatePosterStorageGeneration] =
    await Promise.all([
      capturePrivateVideoGeneration(preflightPaths.privateVideoStoragePath),
      capturePrivateVideoGeneration(preflightPaths.privatePosterStoragePath),
    ]);
  let processingCleanupPending = false;
  try {
    const committed = await commitProfileVideoDeletionRequest(db, {
      ownerUid, videoId, now, eventId,
      privateVideoRef, publicationRef, publicVideoRef,
      processingJobRef, identityRef, deletionJobRef: jobRef,
      allowQuarantined: options.allowQuarantined,
      buildJob: ({ privateVideo, publication, processingJob },
        cleanupPending): VideoDeletionJob => {
        const video = privateVideo.exists
          ? privateVideo.data() as PrivateVideoDoc : null;
        const publicationData = publication.exists
          ? publication.data() as VideoPublicationDoc : null;
        const processing = processingJob.exists
          ? processingJob.data() as VideoProcessingJobDoc : null;
        const currentPaths = resolvePrivateDeletionPaths(
          ownerUid, videoId, video, processing
        );
        if (currentPaths.privateVideoStoragePath !== preflightPaths.privateVideoStoragePath ||
            currentPaths.privatePosterStoragePath !== preflightPaths.privatePosterStoragePath) {
          throw new HttpsError(
            'aborted',
            'Arquivos privados do vídeo alterados durante a exclusão.'
          );
        }
        return {
          ownerUid, videoId,
          ...currentPaths,
          privateVideoStorageGeneration,
          privatePosterStorageGeneration,
          processedOutputPrefix:
            normalizeOwnedProcessedVideoPrefix(
              ownerUid, videoId, video?.processedOutputPrefix
            ) ??
            normalizeOwnedProcessedVideoPrefix(
              ownerUid, videoId, processing?.outputPrefix
            ),
          publishedVideoStoragePath:
            publicationData?.publishedStoragePath ?? null,
          publishedPosterStoragePath:
            publicationData?.publishedPosterStoragePath ?? null,
          processingCleanupPending: cleanupPending,
          createdAt: now,
          updatedAt: now,
          attempts: 0,
          lastError: null,
        };
      },
    });
    if (committed.kind === 'EXISTING') {
      return { videoId, cleanupPending: true };
    }
    processingCleanupPending = committed.processingCleanupPending;
  } catch (error) {
    // Preserve existing retry/lease when another invocation won creation.
    if ((await jobRef.get()).exists) {
      return { videoId, cleanupPending: true };
    }
    throw error;
  }
  await refreshMetricsBestEffort(ownerUid);

  try {
    const pending = await processVideoDeletionJob(jobRef);
    return { videoId, cleanupPending: pending || processingCleanupPending };
  } catch (error) {
    // An unclaimed or unsettled job remains persisted for future recovery.
    logger.error('[deleteProfileVideo] Limpeza fisica pendente.', {
      jobId, error: normalizeErrorMessage(error),
    });
    return { videoId, cleanupPending: true };
  }
}

export const deleteProfileVideo = onCall<DeleteProfileVideoRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<DeleteProfileVideoResponse> => {
    assertCallableAppCheck(request.app);

    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    assertOwner(requesterUid, ownerUid);
    await consumeBackendRateLimitQuota({
      action: 'video-delete',
      subject: ownerUid,
      config: VIDEO_DELETE_RATE_LIMIT,
      message: 'Muitas exclusões de vídeo foram solicitadas em pouco tempo.',
    });
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
    try {
      // The resumable migration makes older unscheduled jobs selectable.
      await migrateLegacyPublishedVideoCleanupJobs(db, {
        cleanupCollection: DELETION_JOBS_COLLECTION,
        migrationId: 'profile-video-deletion-v1',
      });
    } catch (error) {
      logger.error('[videoDeletion] Falha na migracao incremental.', {
        error: normalizeErrorMessage(error),
      });
    }

    const now = Date.now();
    const jobsSnapshot = await db.collection(DELETION_JOBS_COLLECTION)
      .where('nextAttemptAt', '<=', now)
      .orderBy('nextAttemptAt')
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    for (const candidate of jobsSnapshot.docs) {
      try {
        await processVideoDeletionJob(candidate.ref);
      } catch (error) {
        logger.error('[videoDeletion] Tentativa nao concluida.', {
          jobId: candidate.id, error: normalizeErrorMessage(error),
        });
      }
    }
    // Piggyback on the existing scheduler: no extra periodic Function.
    await processPendingVideoOriginalCleanupJobs();
  }
);
