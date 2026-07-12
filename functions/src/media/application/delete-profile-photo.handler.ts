import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';

interface DeleteProfilePhotoRequest {
  ownerUid?: string;
  photoId?: string;
}

interface DeleteProfilePhotoResponse {
  photoId: string;
  cleanupPending: boolean;
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

function normalizeOwnedPrivatePhotoPath(
  ownerUid: string,
  value: unknown
): string | null {
  const storagePath = String(value ?? '')
    .trim()
    .replace(/^\/+/, '');
  const escapedOwnerUid = ownerUid.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );
  const expectedPath = new RegExp(
    `^users/${escapedOwnerUid}/uploads/images/[^/]+$`
  );

  return expectedPath.test(storagePath) ? storagePath : null;
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

  await storage
    .bucket()
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

  await jobRef.set(
    {
      attempts: FieldValue.increment(1),
      updatedAt: Date.now(),
      lastError: normalizeErrorMessage(error),
    },
    { merge: true }
  );
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

    const privatePhotoRef = db.doc(`users/${ownerUid}/photos/${photoId}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/photo_publications/${photoId}`
    );
    const publicPhotoRef = db.doc(
      `public_profiles/${ownerUid}/public_photos/${photoId}`
    );
    const privatePhotoSnap = await privatePhotoRef.get();

    if (!privatePhotoSnap.exists) {
      const cleanupBatch = db.batch();
      cleanupBatch.delete(publicationRef);
      cleanupBatch.delete(publicPhotoRef);
      await cleanupBatch.commit();
      await refreshPublicProfileMediaMetrics(ownerUid);

      return {
        photoId,
        cleanupPending: false,
      };
    }

    const privatePhoto = privatePhotoSnap.data() as PrivatePhotoDoc;
    const storagePath = normalizeOwnedPrivatePhotoPath(
      ownerUid,
      privatePhoto.path
    );

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

    /**
     * Primeiro removemos toda projeção pública e registramos um job durável.
     * A limpeza física ocorre depois. Se Storage ou recursiveDelete falharem,
     * o agendador pode retomar sem republicar a foto.
     */
    const hideBatch = db.batch();
    hideBatch.set(jobRef, job);
    hideBatch.delete(publicationRef);
    hideBatch.delete(publicPhotoRef);
    await hideBatch.commit();
    await refreshPublicProfileMediaMetrics(ownerUid);

    try {
      await executeDeletionJob(jobId, job);

      return {
        photoId,
        cleanupPending: false,
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
        !normalizeOwnedPrivatePhotoPath(job.ownerUid, job.storagePath)
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
