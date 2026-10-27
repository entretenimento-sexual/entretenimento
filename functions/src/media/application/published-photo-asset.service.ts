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
  deleteGenerationPinnedVideoFile,
  normalizeGcsGeneration,
  VideoDeletionGenerationConflictError,
} from './video-deletion-storage-pages';
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
  /** GCS generation captured before a destructive attempt; legacy jobs lack it. */
  generation?: string | null;
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

/** Absent is safe to skip; a supplied invalid path needs explicit review. */
function resolvePublishedPhotoCleanupPath(
  ownerUid: string,
  photoId: string,
  value: string | null | undefined
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const path = normalizeOwnedPublishedPhotoPath(ownerUid, photoId, value);
  if (!path) {
    throw new Error('Caminho de foto publicada inválido; revisão manual necessária.');
  }
  return path;
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
  generation: string | null,
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
    // An old obligation must never retarget another generation at the same path.
    const previousGeneration = normalizeGcsGeneration(current?.generation);
    if (previousGeneration && generation && previousGeneration !== generation) {
      return;
    }
    const pinnedGeneration = previousGeneration ?? generation;
    const needsReview = !pinnedGeneration ||
      error instanceof VideoDeletionGenerationConflictError;
    const retry = nextPhotoCleanupRetry(current?.attempts ?? 0, now);

    const job: PublishedPhotoAssetCleanupJob = {
      ownerUid: command.ownerUid,
      photoId: command.photoId,
      storagePath,
      reason: command.reason,
      generation: pinnedGeneration,
      ...(retentionGuard ? { retentionGuard } : {}),
      createdAt: safeCleanupCreatedAt(current?.createdAt, now),
      updatedAt: now,
      attempts: needsReview ? PHOTO_CLEANUP_MAX_ATTEMPTS : retry.attempts,
      lastError: normalizeErrorMessage(error),
      state: needsReview ? 'dead_letter' : retry.state,
      nextAttemptAt: needsReview ? null : retry.nextAttemptAt,
      deadLetterExpiresAt: needsReview ? null : retry.deadLetterExpiresAt,
    };

    transaction.set(jobRef, job, { merge: true });
  });
}

export function stagePublishedPhotoAssetCleanup(
  transaction: FirebaseFirestore.Transaction,
  command: DeletePublishedPhotoAssetCommand
): StagedPublishedPhotoAssetCleanup | null {
  const storagePath = resolvePublishedPhotoCleanupPath(
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
      // Do not reset an already pinned generation on an existing obligation.
      // The first direct attempt may capture one for a newly staged record.
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

/**
 * DIRETRIZ DE PRODUTO MEDIA V1 - ARQUIVO UNICO
 *
 * A entrada de upload e tecnica e temporaria, nao biblioteca.
 * O backend deve validar e normalizar a imagem final.
 * Apos o commit seguro, somente o ativo publicado permanece.
 * O original pre-edicao e o historico nunca sao armazenados.
 *
 * Na substituicao, o ativo antigo permanece ate a nova versao
 * estar confirmada; depois deve ser eliminado com protecao
 * contra corridas, exceto retencao legal/de seguranca aplicavel.
 *
 * ATENCAO: este metodo AINDA cria uma copia fisica a partir
 * da origem tecnica. A limpeza pos-publicacao e a adaptacao
 * dos fluxos consumidores ainda precisam ser implementadas.
 */
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

  // A failed create-only write must never delete an existing generation.
  await destinationFile.save(sanitized.data, {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: {
      contentType: sanitized.contentType,
      contentDisposition: 'inline',
      cacheControl: 'private, max-age=0, no-store, no-transform',
    },
  });
  return destinationPath;
}

export async function deletePublishedPhotoAssetOrQueue(
  command: DeletePublishedPhotoAssetCommand
): Promise<boolean> {
  const storagePath = resolvePublishedPhotoCleanupPath(
    command.ownerUid,
    command.photoId,
    command.storagePath
  );

  if (!storagePath) {
    return true;
  }

  let generation: string | null = null;
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

    const cleanupRef = db
      .collection(CLEANUP_COLLECTION)
      .doc(buildCleanupJobId(storagePath));
    const existingCleanup = await cleanupRef.get();
    const file = getDefaultStorageBucket().file(storagePath);
    const recordedGeneration = existingCleanup.exists
      ? existingCleanup.get('generation') : null;
    if (recordedGeneration !== null && recordedGeneration !== undefined) {
      generation = normalizeGcsGeneration(recordedGeneration);
      if (!generation) {
        throw new VideoDeletionGenerationConflictError(
          'Invalid published photo cleanup generation; manual review required.'
        );
      }
    } else {
      try {
        const [metadata] = await file.getMetadata();
        generation = normalizeGcsGeneration(metadata.generation);
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error
          ? (error as { code: unknown }).code : null;
        if (code === 404 || code === '404') {
          // The object is already absent; do not touch any later replacement.
          generation = null;
        } else {
          throw error;
        }
      }
    }
    if (generation) {
      await deleteGenerationPinnedVideoFile(generation, (expected) =>
        file.delete({ ignoreNotFound: true, ifGenerationMatch: expected })
      );
    } else {
      // A missing generation is only safe to acknowledge if Storage confirmed
      // the object was absent. Do not turn malformed metadata into a delete.
      const [exists] = await file.exists();
      if (exists) {
        throw new VideoDeletionGenerationConflictError(
          'Missing published photo generation; manual review required.'
        );
      }
    }

    if (existingCleanup.exists) {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(cleanupRef);
        if (!current.exists ||
            current.get('ownerUid') !== existingCleanup.get('ownerUid') ||
            current.get('photoId') !== existingCleanup.get('photoId') ||
            current.get('storagePath') !== existingCleanup.get('storagePath') ||
            current.get('createdAt') !== existingCleanup.get('createdAt') ||
            current.get('updatedAt') !== existingCleanup.get('updatedAt')) return;
        tx.delete(cleanupRef);
      }).catch((error) => {
        logger.warn('[publishedPhotoAsset] Finalização de job pendente.', {
          ownerUid: command.ownerUid,
          photoId: command.photoId,
          error: normalizeErrorMessage(error),
        });
      });
    }

    return true;
  } catch (error) {
    await enqueuePublishedPhotoAssetCleanup(command, storagePath, generation, error);

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
  const deadLetterPurged = 0; // retained for telemetry schema compatibility

  for (const jobDoc of jobsSnapshot.docs) {
    const job = jobDoc.data() as PublishedPhotoAssetCleanupJob;
    const storagePath = normalizeOwnedPublishedPhotoPath(
      job.ownerUid,
      job.photoId,
      job.storagePath
    );

    if (!storagePath) {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(jobDoc.ref);
        if (!current.exists ||
              current.get('ownerUid') !== job.ownerUid ||
              current.get('photoId') !== job.photoId ||
              current.get('storagePath') !== job.storagePath ||
              current.get('createdAt') !== job.createdAt ||
              current.get('updatedAt') !== job.updatedAt ||
            current.get('attempts') !== job.attempts) return;
        tx.update(jobDoc.ref, {
          state: 'dead_letter',
          attempts: PHOTO_CLEANUP_MAX_ATTEMPTS,
          nextAttemptAt: null,
          deadLetterExpiresAt: null,
          updatedAt: Date.now(),
          lastError: 'Job de limpeza com storagePath inválido.',
        });
      });
      deadLetter += 1;
      logger.error('[publishedPhotoAsset] Job de limpeza inválido.', {
        jobId: jobDoc.id,
      });
      continue;
    }

    // Jobs written before generation pinning cannot safely target a generation.
    // Fail closed rather than rediscovering (and deleting) a replacement object.
    if (!normalizeGcsGeneration(job.generation)) {
      await db.runTransaction(async (tx) => {
        const current = await tx.get(jobDoc.ref);
        if (!current.exists ||
            current.get('ownerUid') !== job.ownerUid ||
            current.get('photoId') !== job.photoId ||
            current.get('storagePath') !== job.storagePath ||
            current.get('createdAt') !== job.createdAt ||
            current.get('updatedAt') !== job.updatedAt ||
            current.get('attempts') !== job.attempts) return;
        tx.update(jobDoc.ref, {
          state: 'dead_letter',
          attempts: PHOTO_CLEANUP_MAX_ATTEMPTS,
          nextAttemptAt: null,
          deadLetterExpiresAt: null,
          updatedAt: Date.now(),
          lastError: 'Missing GCS generation; manual review required.',
        });
      });
      deadLetter += 1;
      continue;
    }

    try {
      if (await hasPublishedPhotoRetentionBlocker(job)) {
        const now = Date.now();
        await db.runTransaction(async (tx) => {
          const current = await tx.get(jobDoc.ref);
          if (!current.exists ||
              current.get('ownerUid') !== job.ownerUid ||
              current.get('photoId') !== job.photoId ||
              current.get('storagePath') !== job.storagePath ||
              current.get('createdAt') !== job.createdAt ||
              current.get('updatedAt') !== job.updatedAt ||
              current.get('attempts') !== job.attempts) return;
          tx.update(jobDoc.ref, {
            state: 'waiting_retention',
            nextAttemptAt: photoCleanupRetentionRecheckAt(now),
            deadLetterExpiresAt: null,
            updatedAt: now,
            lastError: null,
          });
        });
        waitingRetention += 1;
        continue;
      }

      await deleteGenerationPinnedVideoFile(job.generation, (expected) =>
        getDefaultStorageBucket().file(storagePath).delete({
          ignoreNotFound: true,
          ifGenerationMatch: expected,
        })
      );
      await db.runTransaction(async (tx) => {
        const current = await tx.get(jobDoc.ref);
        if (!current.exists ||
            current.get('ownerUid') !== job.ownerUid ||
            current.get('photoId') !== job.photoId ||
            current.get('storagePath') !== job.storagePath ||
            current.get('createdAt') !== job.createdAt ||
            current.get('updatedAt') !== job.updatedAt) return;
        tx.delete(jobDoc.ref);
      });
      deleted += 1;
    } catch (error) {
      const now = Date.now();
      const retry = nextPhotoCleanupRetry(job.attempts, now);
      const needsReview = error instanceof VideoDeletionGenerationConflictError;
      await db.runTransaction(async (tx) => {
        const current = await tx.get(jobDoc.ref);
        if (!current.exists ||
            current.get('ownerUid') !== job.ownerUid ||
            current.get('photoId') !== job.photoId ||
            current.get('storagePath') !== job.storagePath ||
            current.get('createdAt') !== job.createdAt ||
            current.get('updatedAt') !== job.updatedAt ||
            current.get('attempts') !== job.attempts) return;
        tx.update(jobDoc.ref, {
          state: needsReview ? 'dead_letter' : retry.state,
          attempts: needsReview ? PHOTO_CLEANUP_MAX_ATTEMPTS : retry.attempts,
          nextAttemptAt: needsReview ? null : retry.nextAttemptAt,
          deadLetterExpiresAt: needsReview ? null : retry.deadLetterExpiresAt,
          updatedAt: now,
          lastError: normalizeErrorMessage(error),
        });
      });

      if (needsReview || retry.state === 'dead_letter') {
        deadLetter += 1;
      } else {
        retryable += 1;
      }

      logger.error('[publishedPhotoAsset] Falha no retry de limpeza.', {
        jobId: jobDoc.id,
        ownerUid: job.ownerUid,
        photoId: job.photoId,
        state: needsReview ? 'dead_letter' : retry.state,
        attempts: needsReview ? PHOTO_CLEANUP_MAX_ATTEMPTS : retry.attempts,
        error: normalizeErrorMessage(error),
      });
    }
  }

  // Deliberately do not purge terminal obligations by age. Old generations
  // and retained evidence need explicit audited reconciliation, not a timer.

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
      deadLetterPurged,
    },
  });
}
