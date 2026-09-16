import { createHash, randomUUID } from 'node:crypto';

import { logger } from 'firebase-functions';

import { db, getDefaultStorageBucket } from '../../firebaseApp';
import {
  IMAGE_INPUT_MIME_TYPES,
  IMAGE_MAX_BYTES,
} from '../media-format.generated';
import {
  buildPublishedPhotoPath,
  normalizeOwnedPublishedPhotoPath,
} from './photo-storage-path';

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
const ALLOWED_IMAGE_CONTENT_TYPES = new Set<string>(IMAGE_INPUT_MIME_TYPES);
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
  const job: PublishedPhotoAssetCleanupJob = {
    ownerUid: command.ownerUid,
    photoId: command.photoId,
    storagePath,
    reason: command.reason,
    ...(retentionGuard ? { retentionGuard } : {}),
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    lastError: normalizeErrorMessage(error),
  };

  await db
    .collection(CLEANUP_COLLECTION)
    .doc(buildCleanupJobId(storagePath))
    .set(job, { merge: true });
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
  const contentType = String(sourceMetadata.contentType ?? '').trim().toLowerCase();
  const sizeBytes = Number(sourceMetadata.size ?? 0);

  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    throw new Error('O arquivo privado não possui um formato de imagem suportado.');
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error('Não foi possível validar o tamanho da imagem privada.');
  }

  if (sizeBytes > IMAGE_MAX_BYTES) {
    throw new Error('A imagem privada excede o limite permitido para publicação.');
  }

  const assetVersion = `${Date.now()}-${randomUUID()}`;
  const destinationPath = buildPublishedPhotoPath(
    command.ownerUid,
    command.photoId,
    assetVersion
  );
  const destinationFile = bucket.file(destinationPath);

  try {
    await sourceFile.copy(destinationFile, {
      metadata: {
        contentType,
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
      logger.info('[publishedPhotoAsset] Limpeza adiada por evidência de moderação.', {
        ownerUid: command.ownerUid,
        photoId: command.photoId,
        reason: command.reason,
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
  const jobsSnapshot = await db
    .collection(CLEANUP_COLLECTION)
    .limit(batchSize)
    .get();

  for (const jobDoc of jobsSnapshot.docs) {
    const job = jobDoc.data() as PublishedPhotoAssetCleanupJob;
    const storagePath = normalizeOwnedPublishedPhotoPath(
      job.ownerUid,
      job.photoId,
      job.storagePath
    );

    if (!storagePath) {
      logger.error('[publishedPhotoAsset] Job de limpeza inválido.', {
        jobId: jobDoc.id,
      });
      continue;
    }

    try {
      if (await hasPublishedPhotoRetentionBlocker(job)) {
        await jobDoc.ref.set(
          {
            updatedAt: Date.now(),
            lastError: null,
          },
          { merge: true }
        );
        continue;
      }

      await getDefaultStorageBucket()
        .file(storagePath)
        .delete({ ignoreNotFound: true });
      await jobDoc.ref.delete();
    } catch (error) {
      await jobDoc.ref.set(
        {
          attempts: Number(job.attempts ?? 0) + 1,
          updatedAt: Date.now(),
          lastError: normalizeErrorMessage(error),
        },
        { merge: true }
      );

      logger.error('[publishedPhotoAsset] Falha no retry de limpeza.', {
        jobId: jobDoc.id,
        ownerUid: job.ownerUid,
        photoId: job.photoId,
        error: normalizeErrorMessage(error),
      });
    }
  }
}
