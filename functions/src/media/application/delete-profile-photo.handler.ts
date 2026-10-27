import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, getDefaultStorageBucket } from '../../firebaseApp';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import { isPhotoPublicationApproved } from './photo-publication-moderation.policy';
import { finalizePhotoDeletionJob } from './photo-deletion-job-finalization';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import {
  PHOTO_CLEANUP_MAX_ATTEMPTS,
  nextPhotoCleanupRetry,
  type PhotoCleanupJobState,
} from './photo-cleanup-job.policy';
import { logPhotoOperation } from './photo-operation-telemetry';
import {
  deletePublishedPhotoAssetOrQueue,
  stagePublishedPhotoAssetCleanup,
} from './published-photo-asset.service';
import { refreshPublicProfileMediaMetrics } from './public-profile-media-metrics';
import {
  deleteGenerationPinnedVideoFile,
  normalizeGcsGeneration,
  VideoDeletionGenerationConflictError,
} from './video-deletion-storage-pages';

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
  onlyIfUnpublished?: boolean;
}

interface PhotoDeletionJob {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  /** Exact GCS generation, or 'absent' if the object was absent when staged. */
  storageGeneration?: string;
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
const PHOTO_DELETE_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 10,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 40,
});

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

async function capturePrivatePhotoGeneration(storagePath: string): Promise<string> {
  try {
    const [metadata] = await getDefaultStorageBucket().file(storagePath).getMetadata();
    const generation = normalizeGcsGeneration(metadata.generation);
    if (!generation) {
      throw new VideoDeletionGenerationConflictError(
        'Missing private photo generation; manual review required.'
      );
    }
    return generation;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error
      ? (error as { code: unknown }).code : null;
    if (code === 404 || code === '404') return 'absent';
    throw error;
  }
}

async function executeDeletionJob(
  jobId: string,
  job: PhotoDeletionJob
): Promise<void> {
  const privatePhotoRef = db.doc(
    `users/${job.ownerUid}/photos/${job.photoId}`
  );

  // A legacy job cannot infer its original generation from today's object.
  const generation = normalizeGcsGeneration(job.storageGeneration);
  if (generation) {
    await deleteGenerationPinnedVideoFile(generation, (expected) =>
      getDefaultStorageBucket().file(job.storagePath).delete({
        ignoreNotFound: true,
        ifGenerationMatch: expected,
      })
    );
  } else if (job.storageGeneration === 'absent') {
    // Absence recorded at staging is not permission to remove a later upload.
    const [exists] = await getDefaultStorageBucket().file(job.storagePath).exists();
    if (exists) {
      throw new VideoDeletionGenerationConflictError(
        'Previously absent private photo now exists; manual review required.'
      );
    }
  } else {
    throw new VideoDeletionGenerationConflictError(
      'Unpinned private photo deletion; manual review required.'
    );
  }

  await db.recursiveDelete(privatePhotoRef);
  await finalizePhotoDeletionJob(db, jobId, job);
}

async function recordDeletionAttemptFailure(
  jobId: string,
  job: PhotoDeletionJob,
  error: unknown
): Promise<PhotoCleanupJobState> {
  const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);
  const now = Date.now();
  const retry = nextPhotoCleanupRetry(job.attempts, now);
  const needsReview = error instanceof VideoDeletionGenerationConflictError;

  try {
    await db.runTransaction(async (tx) => {
      const current = await tx.get(jobRef);
      if (!current.exists ||
          current.get('ownerUid') !== job.ownerUid ||
          current.get('photoId') !== job.photoId ||
          current.get('storagePath') !== job.storagePath ||
          current.get('createdAt') !== job.createdAt) {
        return;
      }
      // Do not allow a stale retry to regress the attempt counter.
      if (Number(current.get('attempts') ?? 0) !== job.attempts) return;
      tx.update(jobRef, {
        state: needsReview ? 'dead_letter' : retry.state,
        attempts: needsReview ? PHOTO_CLEANUP_MAX_ATTEMPTS : retry.attempts,
        nextAttemptAt: needsReview ? null : retry.nextAttemptAt,
        deadLetterExpiresAt: needsReview ? null : retry.deadLetterExpiresAt,
        updatedAt: now,
        lastError: normalizeErrorMessage(error),
      });
    });
  } catch (updateError) {
    logger.warn('[photoDeletion] Job já não está disponível para atualização.', {
      jobId,
      error: normalizeErrorMessage(updateError),
    });
  }

  return needsReview ? 'dead_letter' : retry.state;
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

  if (options.onlyIfUnpublished && publicationSnap.exists) {
    throw new HttpsError('failed-precondition', 'Publicação existente; limpeza bloqueada.');
  }
  if (options.onlyIfUnpublished && !privatePhotoSnap.exists) {
    return { photoId, cleanupPending: false };
  }

  if (!privatePhotoSnap.exists) {
    // Publication removal and the durable Storage cleanup obligation MUST
    // share a transaction, even when the private photo was already removed.
    const missingPhotoCleanup = await db.runTransaction(async (tx) => {
      const jobRef = db.collection(DELETION_JOBS_COLLECTION)
        .doc(buildDeletionJobId(ownerUid, photoId));
      const [currentPrivate, currentPublication, pendingJob] = await Promise.all([
        tx.get(privatePhotoRef), tx.get(publicationRef), tx.get(jobRef),
      ]);
      if (pendingJob.exists) {
        if (pendingJob.get('ownerUid') !== ownerUid ||
            pendingJob.get('photoId') !== photoId) {
          throw new HttpsError(
            'failed-precondition',
            'Obrigação de exclusão de foto com identidade divergente.'
          );
        }
        return { kind: 'PENDING' } as const;
      }
      if (currentPrivate.exists) {
        throw new HttpsError('aborted', 'Foto alterada durante a exclusão.');
      }
      const currentPublicationData = currentPublication.exists
        ? currentPublication.data() as PhotoPublicationDoc
        : null;
      if (isModerationLockedPublication(currentPublicationData) &&
          options.allowQuarantined !== true) {
        throw new HttpsError(
          'failed-precondition',
          'Esta foto está temporariamente preservada durante uma análise de segurança.'
        );
      }
      const storagePath = currentPublicationData?.publishedStoragePath;
      stagePublishedPhotoAssetCleanup(tx, {
        ownerUid, photoId, storagePath,
        reason: 'delete-missing-private-photo',
      });
      tx.delete(publicationRef);
      tx.delete(publicPhotoRef);
      return { kind: 'STAGED', storagePath } as const;
    });
    if (missingPhotoCleanup.kind === 'PENDING') {
      return { photoId, cleanupPending: true };
    }

    const publishedAssetDeleted = await deletePublishedPhotoAssetOrQueue({
      ownerUid,
      photoId,
      storagePath: missingPhotoCleanup.storagePath,
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

  // Pin the actual private object before its deletion obligation is staged.
  // A later overwrite must not become the target of a delayed retry.
  const storageGeneration = await capturePrivatePhotoGeneration(storagePath);
  const now = Date.now();
  const jobId = buildDeletionJobId(ownerUid, photoId);
  const jobRef = db.collection(DELETION_JOBS_COLLECTION).doc(jobId);
  const job: PhotoDeletionJob = {
    ownerUid,
    photoId,
    storagePath,
    storageGeneration,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    lastError: null,
    state: 'retryable',
    nextAttemptAt: now,
    deadLetterExpiresAt: null,
  };

  const staged = await db.runTransaction(async (tx) => {
    const [existingJob, currentPhoto, currentPublication, currentProjection] = await Promise.all([
      tx.get(jobRef),
      tx.get(privatePhotoRef),
      tx.get(publicationRef),
      tx.get(publicPhotoRef),
    ]);
    if (existingJob.exists) {
      if (
        existingJob.get('ownerUid') !== ownerUid ||
        existingJob.get('photoId') !== photoId ||
        existingJob.get('storagePath') !== storagePath
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Obrigação de exclusão de foto com identidade divergente.'
        );
      }
      return false;
    }
    if (options.onlyIfUnpublished && (
      currentPublication.exists || currentProjection.exists ||
      !currentPhoto.exists ||
      currentPhoto.get('feedPublicationPending') !== true ||
      !Number.isFinite(Number(currentPhoto.get('feedPublicationExpiresAtMs'))) ||
      Number(currentPhoto.get('feedPublicationExpiresAtMs')) > Date.now()
    )) {
      throw new HttpsError('failed-precondition', 'Upload não elegível para descarte.');
    }
    if (!currentPhoto.exists ||
        extractOwnedPrivatePhotoPath(ownerUid, currentPhoto.get('path')) !== storagePath &&
        extractOwnedPrivatePhotoPath(ownerUid, currentPhoto.get('url')) !== storagePath) {
      throw new HttpsError('failed-precondition', 'Foto alterada durante a exclusão.');
    }
    const currentPublicationData = currentPublication.exists
      ? currentPublication.data() as PhotoPublicationDoc
      : null;
    if (isModerationLockedPublication(currentPublicationData) &&
        options.allowQuarantined !== true) {
      throw new HttpsError('failed-precondition', 'Foto protegida pela moderação.');
    }
    tx.create(jobRef, job);
    if (options.onlyIfUnpublished) {
      tx.update(privatePhotoRef, {
        feedPublicationPending: FieldValue.delete(),
        feedPublicationExpiresAtMs: FieldValue.delete(),
        feedPublicationCleanupStagedAtMs: now,
      });
    }
    stagePublishedPhotoAssetCleanup(tx, {
      ownerUid, photoId,
      storagePath: currentPublicationData?.publishedStoragePath,
      reason: 'delete-profile-photo',
    });
    tx.delete(publicationRef);
    tx.delete(publicPhotoRef);
    return true;
  });

  // An existing obligation owns its retry history and physical deletion lifecycle.
  if (!staged) return { photoId, cleanupPending: true };

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
    const state = await recordDeletionAttemptFailure(jobId, job, error);

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
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<DeleteProfilePhotoResponse> => {
    assertCallableAppCheck(request.app);

    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
    }

    assertOwner(requesterUid, ownerUid);
    await consumeBackendRateLimitQuota({
      action: 'photo-delete',
      subject: ownerUid,
      config: PHOTO_DELETE_RATE_LIMIT,
      message: 'Muitas exclusões de foto foram solicitadas em pouco tempo.',
    });
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
          job,
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