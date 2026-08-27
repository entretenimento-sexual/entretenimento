import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, getDefaultStorageBucket } from '../../firebaseApp';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import { deletePublishedPhotoAssetOrQueue } from './published-photo-asset.service';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';

interface DeleteProfilePhotoRequest {
  ownerUid?: string;
  photoId?: string;
}

export interface DeleteProfilePhotoResponse {
  photoId: string;
  cleanupPending: boolean;
}

export interface DeleteProfilePhotoResourcesOptions {
  allowQuarantined?: boolean;
}

interface PhotoDeletionJob {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

type PrivatePhotoDoc = {
  path?: string;
  url?: string;
};

type PhotoPublicationDoc = {
  publishedStoragePath?: string;
  moderationStatus?: string;
};

const DELETION_JOBS_COLLECTION = 'media_photo_deletion_jobs';
const CLEANUP_BATCH_SIZE = 100;

function cleanId(value: unknown): string {
  return String(value ?? '').trim();
}

function assertOwner(requesterUid: string | null, ownerUid: string): void {
  if (!requesterUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (requesterUid !== ownerUid) {
    throw new HttpsError(
      'permission-denied',
      'Você só pode excluir fotos do seu próprio perfil.'
    );
  }
}

function isQuarantinedPublication(
  publication: PhotoPublicationDoc | null
): boolean {
  return String(publication?.moderationStatus ?? '')
    .trim()
    .toUpperCase() === 'FLAGGED';
}

function buildDeletionJobId(ownerUid: string, photoId: string): string {
  return `${ownerUid}_${photoId}`;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

async function executeDeletionJob(
  jobId: string,
  job: PhotoDeletionJob
): Promise<void> {
  const privatePhotoRef = db.doc(
    `users/${job.ownerUid}/photos/${job.photoId}`
  );
  const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);

  await getDefaultStorageBucket()
    .file(job.storagePath)
    .delete({ ignoreNotFound: true });

  await db.recursiveDelete(privatePhotoRef);
  await jobRef.delete();
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
    logger.warn('[photoDeletion] Job já não está disponível para atualização.', {
      jobId,
      error: normalizeErrorMessage(updateError),
    });
  }
}

/**
 * Exclusão canônica reutilizável pela ação do proprietário e pela moderação.
 * Evidência preservada fica fora do agregado do usuário em
 * system/moderation-evidence e não é removida por este fluxo.
 *
 * `allowQuarantined` é reservado à moderação depois da preservação probatória.
 * A exclusão do proprietário permanece fail-closed enquanto FLAGGED.
 */
export async function deleteProfilePhotoResources(
  ownerUidValue: unknown,
  photoIdValue: unknown,
  options: DeleteProfilePhotoResourcesOptions = {}
): Promise<DeleteProfilePhotoResponse> {
  const ownerUid = cleanId(ownerUidValue);
  const photoId = cleanId(photoIdValue);

  if (!ownerUid || !photoId) {
    throw new HttpsError('invalid-argument', 'Foto inválida.');
  }

  const privatePhotoRef = db.doc(`users/${ownerUid}/photos/${photoId}`);
  const publicationRef = db.doc(
    `users/${ownerUid}/photo_publications/${photoId}`
  );
  const publicPhotoRef = db.doc(
    `public_profiles/${ownerUid}/public_photos/${photoId}`
  );
  const [privatePhotoSnap, publicationSnap] = await Promise.all([
    privatePhotoRef.get(),
    publicationRef.get(),
  ]);
  const publication = publicationSnap.exists
    ? (publicationSnap.data() as PhotoPublicationDoc)
    : null;

  if (isQuarantinedPublication(publication) && options.allowQuarantined !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Esta foto está temporariamente preservada durante uma análise de segurança.'
    );
  }

  if (!privatePhotoSnap.exists) {
    const cleanupBatch = db.batch();
    if (publicationSnap.exists && publicationSnap.updateTime) {
      cleanupBatch.delete(publicationRef, {
        lastUpdateTime: publicationSnap.updateTime,
      });
    } else {
      cleanupBatch.delete(publicationRef);
    }
    cleanupBatch.delete(publicPhotoRef);
    await cleanupBatch.commit();

    const publishedAssetDeleted = await deletePublishedPhotoAssetOrQueue({
      ownerUid,
      photoId,
      storagePath: publication?.publishedStoragePath,
      reason: 'delete-missing-private-photo',
    });

    await refreshPublicProfileMediaMetrics(ownerUid);

    return {
      photoId,
      cleanupPending: !publishedAssetDeleted,
    };
  }

  const privatePhoto = privatePhotoSnap.data() as PrivatePhotoDoc;
  const storagePath =
    extractOwnedPrivatePhotoPath(ownerUid, privatePhoto.path) ??
    extractOwnedPrivatePhotoPath(ownerUid, privatePhoto.url);

  if (!storagePath) {
    throw new HttpsError(
      'failed-precondition',
      'A foto não possui um caminho privado válido para exclusão.'
    );
  }

  const now = Date.now();
  const jobId = buildDeletionJobId(ownerUid, photoId);
  const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);
  const job: PhotoDeletionJob = {
    ownerUid,
    photoId,
    storagePath,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    lastError: null,
  };

  const hideBatch = db.batch();
  hideBatch.set(jobRef, job);
  if (publicationSnap.exists && publicationSnap.updateTime) {
    hideBatch.delete(publicationRef, {
      lastUpdateTime: publicationSnap.updateTime,
    });
  } else {
    hideBatch.delete(publicationRef);
  }
  hideBatch.delete(publicPhotoRef);
  await hideBatch.commit();

  const publishedAssetDeleted = await deletePublishedPhotoAssetOrQueue({
    ownerUid,
    photoId,
    storagePath: publication?.publishedStoragePath,
    reason: 'delete-profile-photo',
  });

  await refreshPublicProfileMediaMetrics(ownerUid);

  try {
    await executeDeletionJob(jobId, job);

    return {
      photoId,
      cleanupPending: !publishedAssetDeleted,
    };
  } catch (error) {
    await recordDeletionAttemptFailure(jobId, error);

    logger.error('[deleteProfilePhoto] Limpeza física pendente.', {
      ownerUid,
      photoId,
      jobId,
      error: normalizeErrorMessage(error),
    });

    return {
      photoId,
      cleanupPending: true,
    };
  }
}

export const deleteProfilePhoto = onCall<DeleteProfilePhotoRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<DeleteProfilePhotoResponse> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
    }

    assertOwner(requesterUid, ownerUid);
    return deleteProfilePhotoResources(ownerUid, photoId);
  }
);

export const cleanupPendingPhotoDeletions = onSchedule(
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
      const job = jobDoc.data() as PhotoDeletionJob;

      if (
        !cleanId(job.ownerUid) ||
        !cleanId(job.photoId) ||
        !extractOwnedPrivatePhotoPath(job.ownerUid, job.storagePath)
      ) {
        logger.error('[cleanupPendingPhotoDeletions] Job inválido.', {
          jobId: jobDoc.id,
        });
        continue;
      }

      try {
        await executeDeletionJob(jobDoc.id, job);
      } catch (error) {
        await recordDeletionAttemptFailure(jobDoc.id, error);

        logger.error('[cleanupPendingPhotoDeletions] Falha no retry.', {
          jobId: jobDoc.id,
          ownerUid: job.ownerUid,
          photoId: job.photoId,
          error: normalizeErrorMessage(error),
        });
      }
    }
  }
);