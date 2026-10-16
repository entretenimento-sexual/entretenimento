import { randomUUID } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import { deleteVideoStoragePrefixBounded } from './video-deletion-storage-pages';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import { claimVideoDeletionJob, settleVideoDeletionJob } from './video-deletion-queue.firestore';
import {
  retireVideoIdentityForActiveClaim,
  retireVideoIdentityInBatch,
} from './video-identity-guard.firestore';
import { migrateLegacyPublishedVideoCleanupJobs } from './published-video-cleanup-migration.firestore';
import { deletePublishedVideoAssetOrQueueWithResult } from './published-video-asset.service';
import {
  summarizePublishedAssetCleanupResults,
  type PublishedAssetsSummary,
} from './video-deletion-published-cleanup.policy';
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
  isPublished?: boolean;
  publishedStoragePath?: string;
  publishedPosterStoragePath?: string;
  moderationStatus?: string;
  reviewEvidenceRetention?: string;
}

interface VideoProcessingJobDoc {
  sourceStoragePath?: string;
  sourcePosterStoragePath?: string | null;
  outputPrefix?: string;
  state?: string;
}

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

function isQuarantinedPublication(
  publication: VideoPublicationDoc | null
): boolean {
  const moderationStatus = String(publication?.moderationStatus ?? '')
    .trim()
    .toUpperCase();

  if (moderationStatus === 'FLAGGED') {
    return true;
  }

  if (moderationStatus !== 'PENDING_REVIEW') {
    return false;
  }

  const evidenceRetention = String(
    publication?.reviewEvidenceRetention ?? ''
  ).trim().toUpperCase();

  return publication?.isPublished === true ||
    evidenceRetention === 'PUBLISHED_ASSET_LOCKED';
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

async function deleteFilesByPrefix(prefix: string): Promise<void> {
  await deleteVideoStoragePrefixBounded(prefix, async (pagePrefix, limit) => {
    const [files] = await storage.bucket().getFiles({
      prefix: pagePrefix,
      maxResults: limit,
      autoPaginate: false,
    });
    return files.map((file) => ({
      delete: () => file.delete({ ignoreNotFound: true }),
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
  >
): Promise<PublishedAssetsSummary> {
  const [videoResult, posterResult] = await Promise.all([
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

  // A videoId prefix can also match a different ID (e.g. foo and foo-bar).
  // Only exact persisted paths are safe for private object deletion.
  await Promise.all(exactDeleteTasks);
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
    const cleanupPending = await executeDeletionJob(job);
    const completion = await settleVideoDeletionJob(
      db, jobRef, token, { kind: 'COMPLETED' }
    );
    return cleanupPending || completion !== 'REMOVED';
  } catch (error) {
    const detail = normalizeErrorMessage(error);
    const blocked = detail ===
      'Published video asset cleanup blocked; manual review required.';
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
  const identityRef = db.doc(
    `users/${ownerUid}/video_identity_guards/${videoId}`
  );
  const [privateVideoSnap, publicationSnap, processingJobSnap, identitySnap] =
    await Promise.all([
      privateVideoRef.get(),
      publicationRef.get(),
      processingJobRef.get(),
      identityRef.get(),
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

  // Create atomically with unpublication, never overwrite an active retry/lease.
  removalBatch.create(jobRef, {
    ...job,
    state: 'retryable',
    nextAttemptAt: now,
    deadLetterExpiresAt: null,
    leaseToken: null,
    leaseUntil: null,
  });
  retireVideoIdentityInBatch(db, removalBatch, ownerUid, videoId, now, identitySnap);
  if (publicationSnap.exists && publicationSnap.updateTime) {
    removalBatch.delete(publicationRef, {
      lastUpdateTime: publicationSnap.updateTime,
    });
  } else {
    removalBatch.delete(publicationRef);
  }
  removalBatch.delete(publicVideoRef);
  try {
    await removalBatch.commit();
  } catch (error) {
    // If another invocation already registered the job, preserve its state.
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
  }
);
