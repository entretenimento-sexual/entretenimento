import { createHash, randomUUID } from 'node:crypto';
import { FieldPath } from 'firebase-admin/firestore';

import { logger } from 'firebase-functions';

import { db, storage } from '../../firebaseApp';
import {
  IMAGE_INPUT_MIME_TYPES,
  VIDEO_MAX_BYTES,
  VIDEO_POSTER_IMAGE_MAX_BYTES,
  VIDEO_PUBLIC_PLAYBACK_MIME_TYPES,
} from '../media-format.generated';
import { deleteUnreferencedPublishedVideoAsset } from './published-video-asset-cleanup.firestore';
import { MEDIA_CLEANUP_MAX_ATTEMPTS } from './media-cleanup-retry.policy';
import { canClaimVideoCleanupJob, VIDEO_CLEANUP_LEASE_MS } from './video-cleanup-claim.policy';
import { nextVideoCleanupRetry, resolveVideoCleanupJobScheduling } from './video-cleanup-job.policy';
import {
  buildPublishedVideoPath,
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

    const retry = nextVideoCleanupRetry(current?.attempts ?? 0, now);
    const job: PublishedVideoAssetCleanupJob = {
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      storagePath,
      assetKind: command.assetKind,
      reason: command.reason,
      createdAt: typeof current?.createdAt === 'number' &&
          Number.isFinite(current.createdAt) && current.createdAt > 0
        ? current.createdAt
        : now,
      updatedAt: now,
      attempts: retry.attempts,
      lastError: normalizeErrorMessage(error),
      state: retry.state,
      nextAttemptAt: retry.nextAttemptAt,
      deadLetterExpiresAt: retry.deadLetterExpiresAt,
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

export async function copyPrivateVideoToPublishedAsset(
  command: CopyPublishedVideoAssetCommand
): Promise<PublishedVideoAssetResult> {
  const bucket = storage.bucket();
  const processedStoragePath = await resolveProcessedVideoSource(command);
  const sourceVideo = bucket.file(processedStoragePath);
  const [videoExists] = await sourceVideo.exists();

  if (!videoExists) {
    throw new Error('O derivado processado do vídeo não foi encontrado.');
  }

  const [videoMetadata] = await sourceVideo.getMetadata();
  const videoContentType = String(videoMetadata.contentType ?? '')
    .trim()
    .toLowerCase();

  if (!ALLOWED_VIDEO_CONTENT_TYPES.has(videoContentType)) {
    throw new Error(
      'O derivado processado não possui um formato público compatível.'
    );
  }

  const sizeBytes = resolveValidatedSize(
    videoMetadata.size,
    VIDEO_MAX_BYTES
  );
  const assetVersion = `${Date.now()}-${randomUUID()}`;
  const videoStoragePath = buildPublishedVideoPath(
    command.ownerUid,
    command.videoId,
    assetVersion
  );
  const destinationVideo = bucket.file(videoStoragePath);
  let posterStoragePath: string | null = null;

  try {
    await sourceVideo.copy(destinationVideo, {
      metadata: {
        contentType: videoContentType,
        contentDisposition: 'inline',
        cacheControl: 'private, max-age=0, no-store, no-transform',
      },
    });

    const poster = await copyPosterIfAvailable(command, assetVersion);
    posterStoragePath = poster?.storagePath ?? null;

    return {
      sourceProcessedStoragePath: processedStoragePath,
      videoStoragePath,
      posterStoragePath,
      videoContentType,
      sizeBytes,
    };
  } catch (error) {
    const cleanupTasks: Promise<unknown>[] = [
      destinationVideo.delete({ ignoreNotFound: true }).catch(() => undefined),
    ];

    if (posterStoragePath) {
      cleanupTasks.push(
        bucket
          .file(posterStoragePath)
          .delete({ ignoreNotFound: true })
          .catch(() => undefined)
      );
    }

    await Promise.all(cleanupTasks);
    throw error;
  }
}

export async function deletePublishedVideoAssetOrQueue(
  command: DeletePublishedVideoAssetCommand
): Promise<boolean> {
  const storagePath = normalizePublishedAssetPath(
    command.ownerUid,
    command.videoId,
    command.storagePath,
    command.assetKind
  );

  if (!storagePath) {
    return true;
  }

  try {
    const result = await deleteUnreferencedPublishedVideoAsset(
      db, { ...command, storagePath },
      () => storage.bucket().file(storagePath).delete({
        ignoreNotFound: true,
      }).then(() => undefined)
    );

    if (result === 'ACTIVE_REFERENCE') {
      logger.warn('[publishedVideoAsset] Limpeza recusada: ativo publicado.', {
        ownerUid: command.ownerUid,
        videoId: command.videoId,
        assetKind: command.assetKind,
        reason: command.reason,
      });
      return false;
    }

    await db
      .collection(CLEANUP_COLLECTION)
      .doc(buildCleanupJobId(storagePath))
      .delete()
      .catch(() => undefined);

    return true;
  } catch (error) {
    await enqueuePublishedVideoAssetCleanup(command, storagePath, error);

    logger.error('[publishedVideoAsset] Limpeza física pendente.', {
      ownerUid: command.ownerUid,
      videoId: command.videoId,
      assetKind: command.assetKind,
      reason: command.reason,
      storagePath,
      error: normalizeErrorMessage(error),
    });

    return false;
  }
}

const VIDEO_CLEANUP_MIGRATION_COLLECTION = 'media_cleanup_migration_state';
const VIDEO_CLEANUP_MIGRATION_ID = 'published-video-asset-v1';
const VIDEO_CLEANUP_MIGRATION_BATCH_SIZE = 100;

/**
 * Old documents cannot be found by where(nextAttemptAt <= now) because the
 * field is absent. Sweep by document ID with a persisted cursor until every
 * legacy document has acquired its scheduling fields. Never drop old work.
 */
async function migrateLegacyPublishedVideoCleanupJobs(): Promise<void> {
  const progressRef = db.collection(VIDEO_CLEANUP_MIGRATION_COLLECTION)
    .doc(VIDEO_CLEANUP_MIGRATION_ID);
  const progressSnap = await progressRef.get();
  const progress = progressSnap.exists ? progressSnap.data() : null;
  if (progress?.['complete'] === true) return;

  const lastId = typeof progress?.['lastDocumentId'] === 'string'
    ? progress['lastDocumentId']
    : '';
  let query = db.collection(CLEANUP_COLLECTION)
    .orderBy(FieldPath.documentId())
    .limit(VIDEO_CLEANUP_MIGRATION_BATCH_SIZE);
  if (lastId) query = query.startAfter(lastId);
  const snapshot = await query.get();

  // Limit transaction concurrency to avoid unexpected Firestore write spikes.
  for (let index = 0; index < snapshot.docs.length; index += 5) {
    const page = snapshot.docs.slice(index, index + 5);
    await Promise.all(page.map((doc) => db.runTransaction(async (transaction) => {
      const current = await transaction.get(doc.ref);
      if (!current.exists) return;
      const scheduling = resolveVideoCleanupJobScheduling(
        current.data() ?? {}, Date.now()
      );
      if (!scheduling.requiresMigration) return;
      transaction.set(doc.ref, {
        state: scheduling.state,
        nextAttemptAt: scheduling.nextAttemptAt,
        deadLetterExpiresAt: null,
        updatedAt: Date.now(),
      }, { merge: true });
    })));
  }

  await progressRef.set({
    lastDocumentId: snapshot.docs.at(-1)?.id ?? lastId,
    complete: snapshot.size < VIDEO_CLEANUP_MIGRATION_BATCH_SIZE,
    updatedAt: Date.now(),
  }, { merge: true });
}

async function claimPublishedVideoCleanupJob(
  ref: FirebaseFirestore.DocumentReference,
  now: number
): Promise<{ job: PublishedVideoAssetCleanupJob; token: string } | null> {
  const token = randomUUID();
  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists) return null;
    const job = snap.data() as PublishedVideoAssetCleanupJob;
    if (!canClaimVideoCleanupJob(job, now)) return null;

    const leaseUntil = now + VIDEO_CLEANUP_LEASE_MS;
    transaction.set(ref, {
      leaseToken: token,
      leaseUntil,
      nextAttemptAt: leaseUntil,
      updatedAt: now,
    }, { merge: true });
    return { job, token };
  });
}

async function finishPublishedVideoCleanupJob(
  ref: FirebaseFirestore.DocumentReference,
  token: string,
  error: unknown | null
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(ref);
    if (!snap.exists || snap.data()?.['leaseToken'] !== token) return;

    if (error === null) {
      transaction.delete(ref);
      return;
    }
    const current = snap.data() as PublishedVideoAssetCleanupJob;
    const now = Date.now();
    const retry = nextVideoCleanupRetry(current.attempts, now);
    transaction.set(ref, {
      state: retry.state,
      attempts: retry.attempts,
      nextAttemptAt: retry.nextAttemptAt,
      deadLetterExpiresAt: retry.deadLetterExpiresAt,
      updatedAt: now,
      lastError: normalizeErrorMessage(error),
      leaseToken: null,
      leaseUntil: null,
    }, { merge: true });
  });
}

export async function processPendingPublishedVideoAssetCleanupJobs(
  batchSize = 50
): Promise<void> {
  try {
    await migrateLegacyPublishedVideoCleanupJobs();
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
    const claim = await claimPublishedVideoCleanupJob(candidate.ref, Date.now());
    if (!claim) continue;

    const { job, token } = claim;
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

    try {
      const result = await deleteUnreferencedPublishedVideoAsset(
        db,
        { ...job, storagePath },
        () => storage.bucket().file(storagePath)
          .delete({ ignoreNotFound: true }).then(() => undefined)
      );
      if (result === 'ACTIVE_REFERENCE') {
        logger.warn('[publishedVideoAsset] Ativo ainda referenciado; sem exclusão.', {
          jobId: candidate.id,
        });
      }
      await finishPublishedVideoCleanupJob(candidate.ref, token, null);
    } catch (error) {
      await finishPublishedVideoCleanupJob(candidate.ref, token, error);
      logger.error('[publishedVideoAsset] Falha no retry de limpeza.', {
        jobId: candidate.id,
        error: normalizeErrorMessage(error),
      });
    }
  }
}
