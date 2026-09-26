import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  PHOTO_CLEANUP_MAX_ATTEMPTS,
  nextPhotoCleanupRetry,
  type PhotoCleanupJobState,
} from './photo-cleanup-job.policy';
import { logPhotoOperation } from './photo-operation-telemetry';

interface PhotoPublicationState {
  isPublished?: boolean;
}

interface PhotoInteractionCleanupJob {
  ownerUid: string;
  photoId: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
  state: PhotoCleanupJobState;
  nextAttemptAt: number | null;
  deadLetterExpiresAt: number | null;
}

const CLEANUP_COLLECTION = 'media_photo_interaction_cleanup_jobs';
const CLEANUP_BATCH_SIZE = 100;

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function cleanupJobId(ownerUid: string, photoId: string): string {
  return `${ownerUid}_${photoId}`;
}

async function executeCleanup(
  jobRef: FirebaseFirestore.DocumentReference,
  job: Pick<PhotoInteractionCleanupJob, 'ownerUid' | 'photoId'>
): Promise<void> {
  const publicPhotoRef = db.doc(
    `public_profiles/${job.ownerUid}/public_photos/${job.photoId}`
  );

  await db.recursiveDelete(publicPhotoRef);
  await jobRef.delete();
}

async function recordFailure(
  jobRef: FirebaseFirestore.DocumentReference,
  currentAttempts: unknown,
  error: unknown
): Promise<PhotoCleanupJobState> {
  const now = Date.now();
  const retry = nextPhotoCleanupRetry(currentAttempts, now);

  await jobRef.set(
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

  return retry.state;
}

async function enqueueCleanup(
  ownerUid: string,
  photoId: string
): Promise<{
  ref: FirebaseFirestore.DocumentReference;
  job: PhotoInteractionCleanupJob;
}> {
  const now = Date.now();
  const ref = db
    .collection(CLEANUP_COLLECTION)
    .doc(cleanupJobId(ownerUid, photoId));

  const job = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const current = snapshot.exists
      ? snapshot.data() as Partial<PhotoInteractionCleanupJob>
      : null;
    const attempts = Number.isFinite(Number(current?.attempts))
      ? Math.max(0, Math.trunc(Number(current?.attempts)))
      : 0;
    const createdAt = Number.isFinite(Number(current?.createdAt)) &&
        Number(current?.createdAt) > 0
      ? Number(current?.createdAt)
      : now;

    const nextJob: PhotoInteractionCleanupJob = {
      ownerUid,
      photoId,
      createdAt,
      updatedAt: now,
      attempts,
      lastError: current?.lastError ?? null,
      state: current?.state ?? 'retryable',
      nextAttemptAt:
        typeof current?.nextAttemptAt === 'number'
          ? current.nextAttemptAt
          : now,
      deadLetterExpiresAt:
        typeof current?.deadLetterExpiresAt === 'number'
          ? current.deadLetterExpiresAt
          : null,
    };

    transaction.set(ref, nextJob, { merge: true });
    return nextJob;
  });

  return { ref, job };
}

/**
 * Firestore não remove subcoleções ao apagar o documento pai. Ao a publicação
 * deixar de existir, enfileiramos a remoção da árvore pública para que views,
 * comentários e reações não sobrevivam à foto.
 */
export const cleanupUnpublishedPhotoInteractions = onDocumentWritten(
  {
    document: 'users/{ownerUid}/photo_publications/{photoId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const startedAt = Date.now();
    const ownerUid = cleanId(event.params.ownerUid);
    const photoId = cleanId(event.params.photoId);
    const before = event.data?.before.exists
      ? event.data.before.data() as PhotoPublicationState
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data() as PhotoPublicationState
      : null;

    if (
      !ownerUid ||
      !photoId ||
      before?.isPublished !== true ||
      after?.isPublished === true
    ) {
      return;
    }

    const queued = await enqueueCleanup(ownerUid, photoId);

    try {
      await executeCleanup(queued.ref, queued.job);

      logPhotoOperation({
        operation: 'photo.cleanup_public_interactions',
        outcome: 'success',
        startedAt,
        counts: { mediaTreesDeleted: 1 },
      });
    } catch (error) {
      const state = await recordFailure(
        queued.ref,
        queued.job.attempts,
        error
      );

      logPhotoOperation({
        operation: 'photo.cleanup_public_interactions',
        outcome: state === 'dead_letter' ? 'dead_letter' : 'retryable',
        startedAt,
        counts: { queued: 1 },
      });

      logger.error(
        '[cleanupUnpublishedPhotoInteractions] Limpeza pública pendente.',
        {
          ownerUid,
          photoId,
          state,
          error: normalizeErrorMessage(error),
        }
      );
    }
  }
);

export const cleanupPendingPhotoInteractionTrees = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const startedAt = Date.now();
    const snapshot = await db
      .collection(CLEANUP_COLLECTION)
      .where('nextAttemptAt', '<=', startedAt)
      .limit(CLEANUP_BATCH_SIZE)
      .get();
    let deleted = 0;
    let retryable = 0;
    let deadLetter = 0;

    for (const documentSnapshot of snapshot.docs) {
      const job = documentSnapshot.data() as PhotoInteractionCleanupJob;
      const ownerUid = cleanId(job.ownerUid);
      const photoId = cleanId(job.photoId);

      if (!ownerUid || !photoId) {
        await documentSnapshot.ref.set(
          {
            state: 'dead_letter',
            attempts: PHOTO_CLEANUP_MAX_ATTEMPTS,
            nextAttemptAt: null,
            deadLetterExpiresAt: null,
            updatedAt: Date.now(),
            lastError: 'Job de interações públicas inválido.',
          },
          { merge: true }
        );
        deadLetter += 1;
        continue;
      }

      try {
        await executeCleanup(documentSnapshot.ref, {
          ownerUid,
          photoId,
        });
        deleted += 1;
      } catch (error) {
        const state = await recordFailure(
          documentSnapshot.ref,
          job.attempts,
          error
        );

        if (state === 'dead_letter') {
          deadLetter += 1;
        } else {
          retryable += 1;
        }
      }
    }

    logPhotoOperation({
      operation: 'photo.cleanup_public_interaction_jobs',
      outcome:
        deadLetter > 0
          ? 'partial'
          : retryable > 0
            ? 'retryable'
            : 'success',
      startedAt,
      counts: {
        scanned: snapshot.size,
        deleted,
        retryable,
        deadLetter,
      },
    });
  }
);
