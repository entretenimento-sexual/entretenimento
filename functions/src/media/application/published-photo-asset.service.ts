import { createHash, randomUUID } from 'node:crypto';

import { logger } from 'firebase-functions';
import sharp from 'sharp';

import { db, getDefaultStorageBucket } from '../../firebaseApp';
import {
  buildPublishedPhotoPath,
  normalizeOwnedPublishedPhotoPath,
} from './photo-storage-path';
import {
  PHOTO_CLEANUP_MAX_ATTEMPTS,
  nextPhotoCleanupRetry,
  photoCleanupRetentionRecheckAt,
  type PhotoCleanupJobState,
} from './photo-cleanup-job.policy';
import { logPhotoOperation } from './photo-operation-telemetry';
import {
  PUBLISHED_PHOTO_MAX_INPUT_PIXELS,
  PUBLISHED_PHOTO_MAX_OUTPUT_EDGE,
  assertPublishedPhotoDecodedMetadata,
  assertPublishedPhotoOutput,
  assertPublishedPhotoSourceMetadata,
  type CanonicalPublishedPhotoFormat,
} from './published-photo-asset.policy';

export interface PublishedPhotoAssetRetentionGuard {
  targetType: 'community_feed_post';
  targetId: string;
  parentTargetId: string;
}

interface PublishedPhotoAssetCleanupJob {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  reason: string;
  retentionGuard?: PublishedPhotoAssetRetentionGuard;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
  state: PhotoCleanupJobState;
  nextAttemptAt: number | null;
  deadLetterExpiresAt: number | null;
}

interface CopyPublishedPhotoAssetCommand {
  ownerUid: string;
  photoId: string;
  sourceStoragePath: string;
}

export interface DeletePublishedPhotoAssetCommand {
  ownerUid: string;
  photoId: string;
  storagePath: string | null | undefined;
  reason: string;
  retentionGuard?: PublishedPhotoAssetRetentionGuard;
}

export interface StagedPublishedPhotoAssetCleanup {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  reason: string;
  retentionGuard?: PublishedPhotoAssetRetentionGuard;
}

const CLEANUP_COLLECTION = 'media_published_asset_cleanup_jobs';
const COMMUNITY_FEED_CLEANUP_REASONS = new Set([
  'community-feed-post-deleted-by-author',
  'community-feed-post-removed-by-management',
  'community-feed-post-report-review-closed',
]);

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function buildCleanupJobId(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

function safeCleanupAttempts(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function safeCleanupCreatedAt(value: unknown, fallback: number): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeRetentionGuard(
  value: PublishedPhotoAssetRetentionGuard | undefined
): PublishedPhotoAssetRetentionGuard | null {
  if (!value) return null;

  const targetId = String(value.targetId ?? '').trim();
  const parentTargetId = String(value.parentTargetId ?? '').trim();
  if (
    value.targetType !== 'community_feed_post'
    || !targetId
    || !parentTargetId
  ) {
    return null;
  }

  return {
    targetType: 'community_feed_post',
    targetId,
    parentTargetId,
  };
}

function isBlockingModerationStatus(value: unknown): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized !== 'resolved' && normalized !== 'rejected';
}

async function hasPublishedPhotoRetentionBlocker(
  command: Pick<
    DeletePublishedPhotoAssetCommand,
    'photoId' | 'reason' | 'retentionGuard'
  >
): Promise<boolean> {
  const explicitGuard = normalizeRetentionGuard(command.retentionGuard);
  if (command.retentionGuard && !explicitGuard) {
    throw new Error('Guard de retenção de mídia inválido.');
  }

  const legacyCommunityCleanup = COMMUNITY_FEED_CLEANUP_REASONS.has(command.reason);
  if (!explicitGuard && !legacyCommunityCleanup) return false;

  const targetId = explicitGuard?.targetId ?? String(command.photoId ?? '').trim();
  if (!targetId) {
    throw new Error('Alvo de retenção de mídia inválido.');
  }

  const reportsSnapshot = await db
    .collection('moderation_reports')
    .where('targetId', '==', targetId)
    .where('targetType', '==', 'community_feed_post')
    .get();

  return reportsSnapshot.docs.some((doc) => {
    const report = doc.data() ?? {};
    if (
      explicitGuard
      && String(report['parentTargetId'] ?? '').trim()
        !== explicitGuard.parentTargetId
    ) {
      return false;
    }

    return isBlockingModerationStatus(report['status']);
  });
}

async function enqueuePublishedPhotoAssetCleanup(
  command: DeletePublishedPhotoAssetCommand,
  storagePath: string,
  error: unknown
): Promise<void> {
  const now = Date.now();
  const retentionGuard = normalizeRetentionGuard(command.retentionGuard);
  const jobRef = db
    .collection(CLEANUP_COLLECTION)
    .doc(buildCleanupJobId(storagePath));

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    const current = snapshot.exists
      ? (snapshot.data() as Partial<PublishedPhotoAssetCleanupJob>)
      : null;
    const retry = nextPhotoCleanupRetry(current?.attempts ?? 0, now);

    const job: PublishedPhotoAssetCleanupJob = {
      ownerUid: command.ownerUid,
      photoId: command.photoId,
      storagePath,
      reason: command.reason,
      ...(retentionGuard ? { retentionGuard } : {}),
      createdAt: safeCleanupCreatedAt(current?.createdAt, now),
      updatedAt: now,
      attempts: retry.attempts,
      lastError: normalizeErrorMessage(error),
      state: retry.state,
      nextAttemptAt: retry.nextAttemptAt,
      deadLetterExpiresAt: retry.deadLetterExpiresAt,
    };

    transaction.set(jobRef, job, { merge: true });
  });
}

export function stagePublishedPhotoAssetCleanup(
  transaction: FirebaseFirestore.Transaction,
  command: DeletePublishedPhotoAssetCommand
): StagedPublishedPhotoAssetCleanup | null {
  const storagePath = normalizeOwnedPublishedPhotoPath(
    command.ownerUid,
    command.photoId,
    command.storagePath
  );

  if (!storagePath) return null;

  const retentionGuard = normalizeRetentionGuard(command.retentionGuard);
  if (command.retentionGuard && !retentionGuard) {
    throw new Error('Guard de retenção de mídia inválido.');
  }

  const now = Date.now();
  transaction.set(
    db.collection(CLEANUP_COLLECTION).doc(buildCleanupJobId(storagePath)),
    {
      ownerUid: command.ownerUid,
      photoId: command.photoId,
      storagePath,
      reason: command.reason,
      ...(retentionGuard ? { retentionGuard } : {}),
      createdAt: now,
      updatedAt: now,
      attempts: 0,
      lastError: null,
      state: 'retryable',
      nextAttemptAt: now,
      deadLetterExpiresAt: null,
    },
    { merge: true }
  );

  return {
    ownerUid: command.ownerUid,
    photoId: command.photoId,
    storagePath,
    reason: command.reason,
    ...(retentionGuard ? { retentionGuard } : {}),
  };
}

async function encodePublishedPhoto(
  sourceBuffer: Buffer,
  format: CanonicalPublishedPhotoFormat
): Promise<{ data: Buffer; contentType: string }> {
  let pipeline = sharp(sourceBuffer, {
    failOn: 'warning',
    limitInputPixels: PUBLISHED_PHOTO_MAX_INPUT_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .resize({
      width: PUBLISHED_PHOTO_MAX_OUTPUT_EDGE,
      height: PUBLISHED_PHOTO_MAX_OUTPUT_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });

  switch (format) {
  case 'jpeg':
    pipeline = pipeline.jpeg({ quality: 88, progressive: true });
    break;
  case 'png':
    pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
    break;
  case 'webp':
    pipeline = pipeline.webp({ quality: 88, effort: 4 });
    break;
  }

  const output = await pipeline.toBuffer({ resolveWithObject: true });
  assertPublishedPhotoOutput({
    sizeBytes: output.data.byteLength,
    width: output.info.width,
    height: output.info.height,
  });

  const contentType = format === 'jpeg'
    ? 'image/jpeg'
    : format === 'png'
      ? 'image/png'
      : 'image/webp';

  return { data: output.data, contentType };
}

export async function copyPrivatePhotoToPublishedAsset(
  command: CopyPublishedPhotoAssetCommand
): Promise<string> {
  const bucket = getDefaultStorageBucket();
  const sourceFile = bucket.file(command.sourceStoragePath);
  const [sourceExists] = await sourceFile.exists();

  if (!sourceExists) {
    logger.error('[publishedPhotoAsset] Arquivo privado não encontrado.', {
      ownerUid: command.ownerUid,
      photoId: command.photoId,
      bucket: bucket.name,
      sourceStoragePath: command.sourceStoragePath,
      storageEmulator: !!process.env.STORAGE_EMULATOR_HOST,
    });
    throw new Error('O arquivo privado da foto não foi encontrado.');
  }

  const [sourceMetadata] = await sourceFile.getMetadata();
  const source = assertPublishedPhotoSourceMetadata({
    contentType: sourceMetadata.contentType,
    sizeBytes: sourceMetadata.size,
  });
  const [sourceBuffer] = await sourceFile.download();

  if (sourceBuffer.byteLength !== source.sizeBytes) {
    throw new Error(
      'O tamanho real da imagem privada diverge dos metadados do Storage.'
    );
  }

  const decoder = sharp(sourceBuffer, {
    failOn: 'warning',
    limitInputPixels: PUBLISHED_PHOTO_MAX_INPUT_PIXELS,
    sequentialRead: true,
  });
  const decoded = assertPublishedPhotoDecodedMetadata(
    await decoder.metadata(),
    source.expectedFormat
  );
  const sanitized = await encodePublishedPhoto(sourceBuffer, decoded.format);

  const assetVersion = `${Date.now()}-${randomUUID()}`;
  const destinationPath = buildPublishedPhotoPath(
    command.ownerUid,
    command.photoId,
    assetVersion
  );
  const destinationFile = bucket.file(destinationPath);

  try {
    await destinationFile.save(sanitized.data, {
      resumable: false,
      metadata: {
        contentType: sanitized.contentType,
        contentDisposition: 'inline',
        cacheControl: 'private, max-age=0, no-store, no-transform',
      },
    });
    return destinationPath;
  } catch (error) {
    await destinationFile.delete({ ignoreNotFound: true }).catch(() => undefined);
    throw error;
  }
}

export async function deletePublishedPhotoAssetOrQueue(
  command: DeletePublishedPhotoAssetCommand
): Promise<boolean> {
  const storagePath = normalizeOwnedPublishedPhotoPath(
    command.ownerUid,
    command.photoId,
    command.storagePath
  );

  if (!storagePath) {
    return true;
  }

  try {
    if (await hasPublishedPhotoRetentionBlocker(command)) {
      const now = Date.now();
      const retentionGuard = normalizeRetentionGuard(command.retentionGuard);
      const jobRef = db
        .collection(CLEANUP_COLLECTION)
        .doc(buildCleanupJobId(storagePath));

      await db.runTransaction(async (transaction) => {
        const snapshot = await transaction.get(jobRef);
        const current = snapshot.exists
          ? (snapshot.data() as Partial<PublishedPhotoAssetCleanupJob>)
          : null;

        transaction.set(
          jobRef,
          {
            ownerUid: command.ownerUid,
            photoId: command.photoId,
            storagePath,
            reason: command.reason,
            ...(retentionGuard ? { retentionGuard } : {}),
            createdAt: safeCleanupCreatedAt(current?.createdAt, now),
            updatedAt: now,
            attempts: safeCleanupAttempts(current?.attempts),
            lastError: null,
            state: 'waiting_retention',
            nextAttemptAt: photoCleanupRetentionRecheckAt(now),
            deadLetterExpiresAt: null,
          },
          { merge: true }
        );
      });

      logPhotoOperation({
        operation: 'photo.cleanup_published_asset',
        outcome: 'waiting_retention',
        counts: { queued: 1 },
      });
      return false;
    }

    await getDefaultStorageBucket()
      .file(storagePath)
      .delete({ ignoreNotFound: true });

    await db
      .collection(CLEANUP_COLLECTION)
      .doc(buildCleanupJobId(storagePath))
      .delete()
      .catch(() => undefined);

    return true;
  } catch (error) {
    await enqueuePublishedPhotoAssetCleanup(command, storagePath, error);

    logger.error('[publishedPhotoAsset] Limpeza física pendente.', {
      ownerUid: command.ownerUid,
      photoId: command.photoId,
      reason: command.reason,
      storagePath,
      error: normalizeErrorMessage(error),
    });

    return false;
  }
}

export async function processPendingPublishedPhotoAssetCleanupJobs(
  batchSize = 100
): Promise<void> {
  const startedAt = Date.now();
  const jobsSnapshot = await db
    .collection(CLEANUP_COLLECTION)
    .where('nextAttemptAt', '<=', startedAt)
    .limit(batchSize)
    .get();
  let deleted = 0;
  let waitingRetention = 0;
  let retryable = 0;
  let deadLetter = 0;

  for (const jobDoc of jobsSnapshot.docs) {
    const job = jobDoc.data() as PublishedPhotoAssetCleanupJob;
    const storagePath = normalizeOwnedPublishedPhotoPath(
      job.ownerUid,
      job.photoId,
      job.storagePath
    );

    if (!storagePath) {
      await jobDoc.ref.set(
        {
          state: 'dead_letter',
          attempts: PHOTO_CLEANUP_MAX_ATTEMPTS,
          nextAttemptAt: null,
          deadLetterExpiresAt: null,
          updatedAt: Date.now(),
          lastError: 'Job de limpeza com storagePath inválido.',
        },
        { merge: true }
      );
      deadLetter += 1;
      logger.error('[publishedPhotoAsset] Job de limpeza inválido.', {
        jobId: jobDoc.id,
      });
      continue;
    }

    try {
      if (await hasPublishedPhotoRetentionBlocker(job)) {
        const now = Date.now();
        await jobDoc.ref.set(
          {
            state: 'waiting_retention',
            nextAttemptAt: photoCleanupRetentionRecheckAt(now),
            deadLetterExpiresAt: null,
            updatedAt: now,
            lastError: null,
          },
          { merge: true }
        );
        waitingRetention += 1;
        continue;
      }

      await getDefaultStorageBucket()
        .file(storagePath)
        .delete({ ignoreNotFound: true });
      await jobDoc.ref.delete();
      deleted += 1;
    } catch (error) {
      const now = Date.now();
      const retry = nextPhotoCleanupRetry(job.attempts, now);
      await jobDoc.ref.set(
        {
          state: retry.state,
          attempts: retry.attempts,
          nextAttemptAt: retry.nextAttemptAt,
          deadLetterExpiresAt: retry.deadLetterExpiresAt,
          updatedAt: now,
          lastError: normalizeErrorMessage(error),
        },
        { merge: true }
      );

      if (retry.state === 'dead_letter') {
        deadLetter += 1;
      } else {
        retryable += 1;
      }

      logger.error('[publishedPhotoAsset] Falha no retry de limpeza.', {
        jobId: jobDoc.id,
        ownerUid: job.ownerUid,
        photoId: job.photoId,
        state: retry.state,
        attempts: retry.attempts,
        error: normalizeErrorMessage(error),
      });
    }
  }

  logPhotoOperation({
    operation: 'photo.cleanup_published_assets',
    outcome:
      deadLetter > 0
        ? 'partial'
        : waitingRetention > 0
          ? 'waiting_retention'
          : retryable > 0
            ? 'retryable'
            : 'success',
    startedAt,
    counts: {
      scanned: jobsSnapshot.size,
      deleted,
      waitingRetention,
      retryable,
      deadLetter,
    },
  });
}
