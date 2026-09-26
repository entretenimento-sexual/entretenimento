import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, getDefaultStorageBucket } from '../../firebaseApp';
import { isPhotoPublicationApproved } from './photo-publication-moderation.policy';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import {
  PHOTO_CLEANUP_MAX_ATTEMPTS,
  nextPhotoCleanupRetry,
  type PhotoCleanupJobState,
} from './photo-cleanup-job.policy';
import { logPhotoOperation } from './photo-operation-telemetry';
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
  state: PhotoCleanupJobState;
  nextAttemptAt: number | null;
  deadLetterExpiresAt: number | null;
}

type PrivatePhotoDoc = {
  path?: string;
  url?: string;
};

type PhotoPublicationDoc = {
  isPublished?: boolean;
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

function isModerationLockedPublication(
  publication: PhotoPublicationDoc | null
): boolean {
  return publication?.isPublished === true &&
    !isPhotoPublicationApproved(publication.moderationStatus);
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
  currentAttempts: unknown,
  error: unknown
): Promise<PhotoCleanupJobState> {
  const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);
  const now = Date.now();
  const retry = nextPhotoCleanupRetry(currentAttempts, now);

  try {
    await jobRef.update({
      state: retry.state,
      attempts: retry.attempts,
      nextAttemptAt: retry.nextAttemptAt,
      deadLetterExpiresAt: retry.deadLetterExpiresAt,
      updatedAt: now,
      lastError: normalizeErrorMessage(error),
    });
  } catch (updateError) {
    logger.warn('[photoDeletion] Job já não está disponível para atualização.', {
      jobId,
      error: normalizeErrorMessage(updateError),
    });
  }

  return retry.state;
}

/**
 * Exclusão canônica reutilizável pela ação do proprietário e pela moderação.
 * Evidência preservada fica fora do agregado do usuário em
 * system/moderation-evidence e não é removida por este fluxo.
 *
 * `allowQuarantined` é reservado à moderação depois da preservação probatória.
 * A exclusão do proprietário permanece fail-closed enquanto a publicação
 * estiver sem aprovação explícita, inclusive PENDING_REVIEW e FLAGGED.
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

  if (
    isModerationLockedPublication(publication) &&
    options.allowQuarantined !== true
  ) {
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
    state: 'retryable',
    nextAttemptAt: now,
    deadLetterExpiresAt: null,
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
    const state = await recordDeletionAttemptFailure(jobId, job.attempts, error);

    logPhotoOperation({
      operation: 'photo.delete_private_asset',
      outcome: state === 'dead_letter' ? 'dead_letter' : 'retryable',
      counts: { queued: 1 },
    });

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
    const startedAt = Date.now();
    const result = await deleteProfilePhotoResources(ownerUid, photoId);

    logPhotoOperation({
      operation: 'photo.delete',
      outcome: result.cleanupPending ? 'partial' : 'success',
      startedAt,
      counts: {
        cleanupPending: result.cleanupPending ? 1 : 0,
      },
    });

    return result;
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
    const startedAt = Date.now();
    const jobsSnapshot = await db
      .collection(DELETION_JOBS_COLLECTION)
      .where('nextAttemptAt', '<=', startedAt)
      .limit(CLEANUP_BATCH_SIZE)
      .get();
    let deleted = 0;
    let retryable = 0;
    let deadLetter = 0;

    for (const jobDoc of jobsSnapshot.docs) {
      const job = jobDoc.data() as PhotoDeletionJob;

      if (
        !cleanId(job.ownerUid) ||
        !cleanId(job.photoId) ||
        !extractOwnedPrivatePhotoPath(job.ownerUid, job.storagePath)
      ) {
        await jobDoc.ref.set(
          {
            state: 'dead_letter',
            attempts: PHOTO_CLEANUP_MAX_ATTEMPTS,
            nextAttemptAt: null,
            deadLetterExpiresAt: null,
            updatedAt: Date.now(),
            lastError: 'Job de exclusão privada inválido.',
          },
          { merge: true }
        );
        deadLetter += 1;
        logger.error('[cleanupPendingPhotoDeletions] Job inválido.', {
          jobId: jobDoc.id,
        });
        continue;
      }

      try {
        await executeDeletionJob(jobDoc.id, job);
        deleted += 1;
      } catch (error) {
        const state = await recordDeletionAttemptFailure(
          jobDoc.id,
          job.attempts,
          error
        );

        if (state === 'dead_letter') {
          deadLetter += 1;
        } else {
          retryable += 1;
        }

        logger.error('[cleanupPendingPhotoDeletions] Falha no retry.', {
          jobId: jobDoc.id,
          ownerUid: job.ownerUid,
          photoId: job.photoId,
          state,
          error: normalizeErrorMessage(error),
        });
      }
    }

    logPhotoOperation({
      operation: 'photo.cleanup_private_deletions',
      outcome:
        deadLetter > 0
          ? 'partial'
          : retryable > 0
            ? 'retryable'
            : 'success',
      startedAt,
      counts: {
        scanned: jobsSnapshot.size,
        deleted,
        retryable,
        deadLetter,
      },
    });
  }
);