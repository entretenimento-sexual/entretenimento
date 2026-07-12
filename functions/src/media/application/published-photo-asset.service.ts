import { createHash, randomUUID } from 'node:crypto';

import { logger } from 'firebase-functions';

import { db, storage } from '../../firebaseApp';
import {
  buildPublishedPhotoPath,
  normalizeOwnedPublishedPhotoPath,
} from './photo-storage-path';

interface PublishedPhotoAssetCleanupJob {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  reason: string;
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

interface DeletePublishedPhotoAssetCommand {
  ownerUid: string;
  photoId: string;
  storagePath: string | null | undefined;
  reason: string;
}

const CLEANUP_COLLECTION = 'media_published_asset_cleanup_jobs';
const MAX_PUBLISHED_IMAGE_BYTES = 10 * 1024 * 1024;

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function buildCleanupJobId(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

async function enqueuePublishedPhotoAssetCleanup(
  command: DeletePublishedPhotoAssetCommand,
  storagePath: string,
  error: unknown
): Promise<void> {
  const now = Date.now();
  const job: PublishedPhotoAssetCleanupJob = {
    ownerUid: command.ownerUid,
    photoId: command.photoId,
    storagePath,
    reason: command.reason,
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

export async function copyPrivatePhotoToPublishedAsset(
  command: CopyPublishedPhotoAssetCommand
): Promise<string> {
  const bucket = storage.bucket();
  const sourceFile = bucket.file(command.sourceStoragePath);
  const [sourceExists] = await sourceFile.exists();

  if (!sourceExists) {
    throw new Error('O arquivo privado da foto não foi encontrado.');
  }

  const [sourceMetadata] = await sourceFile.getMetadata();
  const contentType = String(sourceMetadata.contentType ?? '').toLowerCase();
  const sizeBytes = Number(sourceMetadata.size ?? 0);

  if (!contentType.startsWith('image/')) {
    throw new Error('O arquivo privado não é uma imagem válida.');
  }

  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error('Não foi possível validar o tamanho da imagem privada.');
  }

  if (sizeBytes > MAX_PUBLISHED_IMAGE_BYTES) {
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
    await storage
      .bucket()
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
      await storage
        .bucket()
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
