import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';

import { db, getDefaultStorageBucket } from '../../firebaseApp';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';

interface PrivatePhotoAssetCleanupJob {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  reason: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

interface DeletePrivatePhotoAssetCommand {
  ownerUid: string;
  photoId: string;
  storagePath: string | null | undefined;
  reason: string;
}

const CLEANUP_COLLECTION = 'media_private_photo_asset_cleanup_jobs';

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function buildCleanupJobId(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

function hashIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

async function enqueuePrivatePhotoAssetCleanup(
  command: DeletePrivatePhotoAssetCommand,
  storagePath: string,
  error: unknown
): Promise<void> {
  const now = Date.now();
  const job: PrivatePhotoAssetCleanupJob = {
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

export async function deletePrivatePhotoAssetOrQueue(
  command: DeletePrivatePhotoAssetCommand
): Promise<boolean> {
  const storagePath = extractOwnedPrivatePhotoPath(
    command.ownerUid,
    command.storagePath
  );

  if (!storagePath) {
    return true;
  }

  const jobRef = db
    .collection(CLEANUP_COLLECTION)
    .doc(buildCleanupJobId(storagePath));

  try {
    await getDefaultStorageBucket()
      .file(storagePath)
      .delete({ ignoreNotFound: true });
    await jobRef.delete().catch(() => undefined);
    return true;
  } catch (error) {
    await enqueuePrivatePhotoAssetCleanup(command, storagePath, error);

    logger.error('[privatePhotoAsset] Limpeza física pendente.', {
      ownerHash: hashIdentity(command.ownerUid),
      photoHash: hashIdentity(command.photoId),
      reason: command.reason,
      pathHash: buildCleanupJobId(storagePath),
      error: normalizeErrorMessage(error),
    });

    return false;
  }
}

export async function processPendingPrivatePhotoAssetCleanupJobs(
  batchSize = 100
): Promise<void> {
  const snapshot = await db
    .collection(CLEANUP_COLLECTION)
    .limit(batchSize)
    .get();

  for (const document of snapshot.docs) {
    const job = document.data() as PrivatePhotoAssetCleanupJob;
    const storagePath = extractOwnedPrivatePhotoPath(
      job.ownerUid,
      job.storagePath
    );

    if (!storagePath) {
      logger.error('[privatePhotoAsset] Job de limpeza inválido.', {
        jobId: document.id,
      });
      continue;
    }

    try {
      await getDefaultStorageBucket()
        .file(storagePath)
        .delete({ ignoreNotFound: true });
      await document.ref.delete();
    } catch (error) {
      await document.ref.set(
        {
          attempts: Number(job.attempts ?? 0) + 1,
          updatedAt: Date.now(),
          lastError: normalizeErrorMessage(error),
        },
        { merge: true }
      );

      logger.error('[privatePhotoAsset] Falha no retry de limpeza.', {
        jobId: document.id,
        ownerHash: hashIdentity(job.ownerUid),
        photoHash: hashIdentity(job.photoId),
        error: normalizeErrorMessage(error),
      });
    }
  }
}
