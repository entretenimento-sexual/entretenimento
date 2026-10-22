import { createHash, randomUUID } from 'node:crypto';

import { logger } from 'firebase-functions';

import { db, storage } from '../../firebaseApp';
import {
  IMAGE_INPUT_MIME_TYPES,
  VIDEO_MAX_BYTES,
  VIDEO_POSTER_IMAGE_MAX_BYTES,
  VIDEO_PUBLIC_PLAYBACK_MIME_TYPES,
} from '../media-format.generated';
import { deleteUnreferencedPublishedVideoAsset } from './published-video-asset-cleanup.firestore';
import type { PublishedAssetCleanupResult } from './video-deletion-published-cleanup.policy';
import { MEDIA_CLEANUP_MAX_ATTEMPTS } from './media-cleanup-retry.policy';
import {
  claimPublishedVideoCleanupJob,
  settlePublishedVideoCleanupJob,
  clearPublishedVideoCleanupJobIfUnleased,
} from './published-video-cleanup-queue.firestore';
import { nextVideoCleanupRetry } from './video-cleanup-job.policy';
import {
  deleteGenerationPinnedVideoFile,
  normalizeGcsGeneration,
  VideoDeletionGenerationConflictError,
} from './video-deletion-storage-pages';
import { migrateLegacyPublishedVideoCleanupJobs } from './published-video-cleanup-migration.firestore';
import {
  buildPublishedVideoPosterPath,
  normalizeOwnedProcessedVideoPath,
  normalizeOwnedPublishedVideoPath,
  normalizeOwnedPublishedVideoPosterPath,
} from './video-storage-path';

interface PublishedVideoAssetCleanupJob {
  ownerUid: string;
  videoId: string;
  storagePath: string;
  assetKind: 'video' | 'poster';
  reason: string;
  /** Persisted GCS generation; absent on historical cleanup obligations. */
  generation?: string | null;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
  state: 'retryable' | 'dead_letter';
  nextAttemptAt: number | null;
  deadLetterExpiresAt: number | null;
  leaseUntil?: number | null;
  leaseToken?: string | null;
}

interface CopyPublishedVideoAssetCommand {
  ownerUid: string;
  videoId: string;
  sourceVideoStoragePath: string;
  sourcePosterStoragePath?: string | null;
}

interface PrivateVideoProcessingDocument {
  status?: string;
  playbackPath?: string;
  processedStoragePath?: string;
  processedMimeType?: string;
  processedSizeBytes?: number;
}

interface PublishedVideoAssetResult {
  sourceProcessedStoragePath: string;
  videoStoragePath: string;
  posterStoragePath: string | null;
  videoContentType: string;
  sizeBytes: number;
}

interface DeletePublishedVideoAssetCommand {
  ownerUid: string;
  videoId: string;
  storagePath: string | null | undefined;
  assetKind: 'video' | 'poster';
  reason: string;
}

const CLEANUP_COLLECTION = 'media_published_video_asset_cleanup_jobs';
const ALLOWED_VIDEO_CONTENT_TYPES = new Set<string>(
  VIDEO_PUBLIC_PLAYBACK_MIME_TYPES
);
const ALLOWED_POSTER_CONTENT_TYPES = new Set<string>(IMAGE_INPUT_MIME_TYPES);

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function buildCleanupJobId(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  const code = (error as { code: unknown }).code;
  return code === 404 || code === '404';
}

/**
 * Capture the exact live generation before a direct delete; retries must use
 * the original persisted value and never rediscover a replacement generation.
 */
async function capturePublishedAssetGeneration(
  storagePath: string,
  recordedGeneration: unknown = null
): Promise<string | null> {
  if (recordedGeneration !== null && recordedGeneration !== undefined) {
    const recorded = normalizeGcsGeneration(recordedGeneration);
    if (!recorded) {
      throw new VideoDeletionGenerationConflictError(
        'Invalid published asset generation; manual review required.'
      );
    }
    return recorded;
  }
  try {
    const [metadata] = await storage.bucket().file(storagePath).getMetadata();
    const generation = normalizeGcsGeneration(metadata.generation);
    if (!generation) {
      throw new VideoDeletionGenerationConflictError(
        'Missing published asset generation; manual review required.'
      );
    }
    return generation;
  } catch (error) {
    // An already-absent object requires no physical delete.
    if (isStorageNotFound(error)) return null;
    throw error;
  }
}

async function deletePublishedAssetWithGeneration(
  storagePath: string,
  generation: string | null
): Promise<void> {
  if (!generation) return;
  await deleteGenerationPinnedVideoFile(generation, (expected) =>
    storage.bucket().file(storagePath).delete({
      ignoreNotFound: true,
      ifGenerationMatch: expected,
    })
  );
}

function resolveValidatedSize(value: unknown, maxBytes: number): number {
  const sizeBytes = Number(value ?? 0);

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error('Não foi possível validar o tamanho do arquivo.');
  }

  if (sizeBytes > maxBytes) {
    throw new Error('O arquivo excede o limite permitido para publicação.');
  }

  return sizeBytes;
}

function normalizePublishedAssetPath(
  ownerUid: string,
  videoId: string,
  storagePath: unknown,
  assetKind: 'video' | 'poster'
): string | null {
  if (assetKind === 'video') {
    return normalizeOwnedPublishedVideoPath(
      ownerUid,
      videoId,
      storagePath
    );
  }

  return normalizeOwnedPublishedVideoPosterPath(
    ownerUid,
    videoId,
    storagePath
  );
}

async function resolveProcessedVideoSource(
  command: CopyPublishedVideoAssetCommand
): Promise<string> {
  const privateVideoSnap = await db
    .doc(`users/${command.ownerUid}/videos/${command.videoId}`)
    .get();

  if (!privateVideoSnap.exists) {
    throw new Error('O vídeo privado não foi encontrado para publicação.');
  }

  const privateVideo =
    privateVideoSnap.data() as PrivateVideoProcessingDocument;
  const status = String(privateVideo.status ?? '').trim().toLowerCase();
  const processedStoragePath =
    normalizeOwnedProcessedVideoPath(
      command.ownerUid,
      command.videoId,
      privateVideo.processedStoragePath
    ) ??
    normalizeOwnedProcessedVideoPath(
      command.ownerUid,
      command.videoId,
      privateVideo.playbackPath
    );

  if (status !== 'ready' || !processedStoragePath) {
    throw new Error(
      'O vídeo ainda não possui um derivado processado para publicação.'
    );
  }

  return processedStoragePath;
}

async function enqueuePublishedVideoAssetCleanup(
  command: DeletePublishedVideoAssetCommand,
  storagePath: string,
  generation: string | null,
  error: unknown
): Promise<void> {
  const now = Date.now();
  const jobRef = db.collection(CLEANUP_COLLECTION).doc(buildCleanupJobId(storagePath));

  await db.runTransaction(async (transaction) => {
    const currentSnap = await transaction.get(jobRef);
    const current = currentSnap.exists
      ? (currentSnap.data() as Partial<PublishedVideoAssetCleanupJob>)
      : null;

    // A failed direct delete must never revive a manual-review record or
    // interfere with a scheduler that already holds the same immutable asset.
    if (current?.state === 'dead_letter' ||
        (typeof current?.leaseUntil === 'number' && current.leaseUntil > now)) {
      return;
    }

    const previousGeneration = normalizeGcsGeneration(current?.generation);
    // A new request cannot turn an old durable job into a different deletion.
    if (previousGeneration && generation && previousGeneration !== generation) {
      return;
    }
    const pinnedGeneration = previousGeneration ?? generation;
    const needsReview = !pinnedGeneration ||
      error instanceof VideoDeletionGenerationConflictError;
    const retry = nextVideoCleanupRetry(current?.attempts ?? 0, now);
    const job: PublishedVideoAssetCleanupJob = {
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      storagePath,
      assetKind: command.assetKind,
      reason: command.reason,
      generation: pinnedGeneration,
      createdAt: typeof current?.createdAt === 'number' &&
          Number.isFinite(current.createdAt) && current.createdAt > 0
        ? current.createdAt
        : now,
      updatedAt: now,
      attempts: needsReview ? MEDIA_CLEANUP_MAX_ATTEMPTS : retry.attempts,
      lastError: normalizeErrorMessage(error),
      state: needsReview ? 'dead_letter' : retry.state,
      nextAttemptAt: needsReview ? null : retry.nextAttemptAt,
      deadLetterExpiresAt: needsReview ? null : retry.deadLetterExpiresAt,
      leaseUntil: null,
      leaseToken: null,
    };

    transaction.set(jobRef, job, { merge: true });
  });
}
async function copyPosterIfAvailable(
  command: CopyPublishedVideoAssetCommand,
  assetVersion: string
): Promise<{
  storagePath: string;
  contentType: string;
} | null> {
  if (!command.sourcePosterStoragePath) {
    return null;
  }

  const bucket = storage.bucket();
  const sourcePoster = bucket.file(command.sourcePosterStoragePath);
  const [posterExists] = await sourcePoster.exists();

  if (!posterExists) {
    return null;
  }

  const [posterMetadata] = await sourcePoster.getMetadata();
  const posterContentType = String(
    posterMetadata.contentType ?? ''
  ).trim().toLowerCase();

  if (!ALLOWED_POSTER_CONTENT_TYPES.has(posterContentType)) {
    throw new Error('O poster privado não é uma imagem suportada.');
  }

  resolveValidatedSize(posterMetadata.size, VIDEO_POSTER_IMAGE_MAX_BYTES);

  const destinationPath = buildPublishedVideoPosterPath(
    command.ownerUid,
    command.videoId,
    assetVersion
  );
  const destinationPoster = bucket.file(destinationPath);

  try {
    await sourcePoster.copy(destinationPoster, {
      metadata: {
        contentType: posterContentType,
        contentDisposition: 'inline',
        cacheControl: 'private, max-age=0, no-store, no-transform',
      },
    });
  } catch (error) {
    await destinationPoster
      .delete({ ignoreNotFound: true })
      .catch(() => undefined);
    throw error;
  }

  return {
    storagePath: destinationPath,
    contentType: posterContentType,
  };
}

/** Reuse the immutable transcoded object: no second GCS video copy. */
export async function prepareProcessedVideoForPublication(
  command: CopyPublishedVideoAssetCommand
): Promise<PublishedVideoAssetResult> {
  const processedStoragePath = await resolveProcessedVideoSource(command);
  const sourceVideo = storage.bucket().file(processedStoragePath);
  const [videoExists] = await sourceVideo.exists();
  if (!videoExists) {
    throw new Error('O derivado processado do vídeo não foi encontrado.');
  }
  const [metadata] = await sourceVideo.getMetadata();
  const videoContentType = String(metadata.contentType ?? '').trim().toLowerCase();
  if (!ALLOWED_VIDEO_CONTENT_TYPES.has(videoContentType)) {
    throw new Error('O derivado processado não possui formato público compatível.');
  }
  const sizeBytes = resolveValidatedSize(metadata.size, VIDEO_MAX_BYTES);
  // The transcoder result must retain the same private no-cache policy as
  // the former published copy, including for revoked signed URLs.
  await sourceVideo.setMetadata({
    contentDisposition: 'inline',
    cacheControl: 'private, max-age=0, no-store, no-transform',
  });
  // Only a poster needs a published copy in phase 1B.
  const version = String(Date.now()) + '-' + randomUUID();
  const poster = await copyPosterIfAvailable(command, version);
  return {
    sourceProcessedStoragePath: processedStoragePath,
    videoStoragePath: processedStoragePath,
    posterStoragePath: poster?.storagePath ?? null,
    videoContentType,
    sizeBytes,
  };
}

export async function deletePublishedVideoAssetOrQueueWithResult(
  command: DeletePublishedVideoAssetCommand
): Promise<PublishedAssetCleanupResult> {
  // An absent asset is already clean. A supplied but invalid path is NOT.
  if (command.storagePath === null || command.storagePath === undefined ||
      command.storagePath === '') {
    return 'DELETED';
  }

  const storagePath = normalizePublishedAssetPath(
    command.ownerUid,
    command.videoId,
    command.storagePath,
    command.assetKind
  );

  if (!storagePath) {
    logger.error('[publishedVideoAsset] Caminho inválido; revisão necessária.', {
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      assetKind: command.assetKind,
      reason: command.reason,
    });
    return 'INVALID_PATH';
  }

  let generation: string | null = null;
  try {
    const result = await deleteUnreferencedPublishedVideoAsset(
      db, { ...command, storagePath },
      async () => {
        const jobSnap = await db.collection(CLEANUP_COLLECTION)
          .doc(buildCleanupJobId(storagePath)).get();
        // Legacy obligations have no trustworthy generation: fail closed.
        if (jobSnap.exists && !normalizeGcsGeneration(jobSnap.get('generation'))) {
          throw new VideoDeletionGenerationConflictError(
            'Legacy published asset cleanup requires manual review.'
          );
        }
        generation = await capturePublishedAssetGeneration(
          storagePath,
          jobSnap.exists ? jobSnap.get('generation') : null
        );
        await deletePublishedAssetWithGeneration(storagePath, generation);
      }
    );

    if (result === 'ACTIVE_REFERENCE') {
      logger.warn('[publishedVideoAsset] Limpeza recusada: ativo publicado.', {
        ownerUid: command.ownerUid,
        videoId: command.videoId,
        assetKind: command.assetKind,
        reason: command.reason,
      });
      return 'ACTIVE_REFERENCE';
    }

    await clearPublishedVideoCleanupJobIfUnleased(
      db,
      db.collection(CLEANUP_COLLECTION).doc(buildCleanupJobId(storagePath))
    ).catch((cleanupError: unknown) => {
      logger.warn('[publishedVideoAsset] Falha ao conciliar job após exclusão.', {
        error: normalizeErrorMessage(cleanupError),
      });
    });

    return 'DELETED';
  } catch (error) {
    // This must succeed durably before the parent deletion job is completed.
    await enqueuePublishedVideoAssetCleanup(command, storagePath, generation, error);

    logger.error('[publishedVideoAsset] Limpeza física pendente.', {
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      assetKind: command.assetKind,
      reason: command.reason,
      storagePath,
      error: normalizeErrorMessage(error),
    });

    return 'QUEUED_FOR_RETRY';
  }
}

/** Compatibility wrapper for existing call sites. */
export async function deletePublishedVideoAssetOrQueue(
  command: DeletePublishedVideoAssetCommand
): Promise<boolean> {
  return (await deletePublishedVideoAssetOrQueueWithResult(command)) === 'DELETED';
}

export async function processPendingPublishedVideoAssetCleanupJobs(
  batchSize = 50
): Promise<void> {
  try {
    await migrateLegacyPublishedVideoCleanupJobs(db);
  } catch (error) {
    // Existing due work must continue even when legacy migration is unavailable.
    logger.error('[publishedVideoAsset] Falha na migração incremental.', {
      error: normalizeErrorMessage(error),
    });
  }
  const startedAt = Date.now();
  const jobsSnapshot = await db.collection(CLEANUP_COLLECTION)
    .where('nextAttemptAt', '<=', startedAt)
    .orderBy('nextAttemptAt')
    .limit(batchSize)
    .get();

  for (const candidate of jobsSnapshot.docs) {
    const token = randomUUID();
    const job = await claimPublishedVideoCleanupJob<PublishedVideoAssetCleanupJob>(
      db, candidate.ref, Date.now(), token
    );
    if (!job) continue;
    const storagePath = normalizePublishedAssetPath(
      job.ownerUid, job.videoId, job.storagePath, job.assetKind
    );

    if (!storagePath) {
      await db.runTransaction(async (transaction) => {
        const snap = await transaction.get(candidate.ref);
        if (!snap.exists || snap.data()?.['leaseToken'] !== token) return;
        transaction.set(candidate.ref, {
          state: 'dead_letter',
          attempts: MEDIA_CLEANUP_MAX_ATTEMPTS,
          nextAttemptAt: null,
          deadLetterExpiresAt: null,
          lastError: 'Invalid published video cleanup asset path.',
          leaseToken: null,
          leaseUntil: null,
          updatedAt: Date.now(),
        }, { merge: true });
      });
      logger.error('[publishedVideoAsset] Job inválido em revisão manual.', {
        jobId: candidate.id,
      });
      continue;
    }

    // A pre-generation legacy job may refer to an object that was replaced.
    // Never infer its original generation from the current Storage object.
    if (!normalizeGcsGeneration(job.generation)) {
      await settlePublishedVideoCleanupJob(
        db, candidate.ref, token,
        'Missing GCS generation; manual review required.',
        Date.now(), true
      );
      continue;
    }

    try {
      const result = await deleteUnreferencedPublishedVideoAsset(
        db,
        { ...job, storagePath },
        () => deletePublishedAssetWithGeneration(storagePath, job.generation ?? null)
      );
      if (result === 'ACTIVE_REFERENCE') {
        logger.warn('[publishedVideoAsset] Ativo ainda referenciado; sem exclusão.', {
          jobId: candidate.id,
        });
      }
      await settlePublishedVideoCleanupJob(db, candidate.ref, token, null);
    } catch (error) {
      await settlePublishedVideoCleanupJob(
        db, candidate.ref, token, normalizeErrorMessage(error),
        Date.now(), error instanceof VideoDeletionGenerationConflictError
      );
      logger.error('[publishedVideoAsset] Falha no retry de limpeza.', {
        jobId: candidate.id,
        error: normalizeErrorMessage(error),
      });
    }
  }
}
