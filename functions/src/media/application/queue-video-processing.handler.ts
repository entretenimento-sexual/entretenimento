import type { DocumentReference } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { completeVideoProcessingInEmulator } from './emulator-video-processing.service';
import {
  DEFAULT_VIDEO_EDIT_RECIPE,
  normalizeVideoEditRecipe,
  VideoEditRecipeValidationError,
  type VideoEditRecipe,
} from './video-edit-recipe';
import {
  buildQueuedVideoProcessingJob,
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
import {
  hasPersistedInvalidProcessingSourceFailure,
  INVALID_PROCESSING_SOURCE_CODE,
} from './video-processing-invalid-source';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

interface PrivateVideoDocument {
  path?: string;
  url?: string;
  thumbnailPath?: string | null;
  thumbnailUrl?: string | null;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number | null;
  editRecipe?: unknown;
  processedStoragePath?: string | null;
  processingJobId?: string | null;
  processingStage?: string;
  processingErrorCode?: string;
  status?: string;
}

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MIN_VIDEO_DURATION_MS = 5_000;
const INVALID_EDIT_RECIPE_CODE = 'INVALID_VIDEO_EDIT_RECIPE';
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : null;
}

function normalizeMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function statusForExistingJob(state: string): {
  status: 'queued' | 'processing' | 'failed';
  stage: string;
} {
  if (state === 'FAILED' || state === 'CANCEL_REQUESTED') {
    return { status: 'failed', stage: 'failed' };
  }

  if (
    state === 'SUBMITTING' ||
    state === 'PROCESSING' ||
    state === 'SUCCEEDED'
  ) {
    return {
      status: 'processing',
      stage: state === 'SUCCEEDED' ? 'finalizing' : state.toLowerCase(),
    };
  }

  return { status: 'queued', stage: 'queued' };
}

function processingJobReference(
  ownerUid: string,
  videoId: string
): DocumentReference {
  return db
    .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .doc(buildVideoProcessingJobId(ownerUid, videoId));
}

function hasProtectedUploadSource(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument
): boolean {
  return !!(
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url)
  );
}

function resolvePersistedEditRecipe(
  rawRecipe: unknown,
  sourceDurationMs: number | null
): VideoEditRecipe {
  if (rawRecipe === undefined || rawRecipe === null) {
    return DEFAULT_VIDEO_EDIT_RECIPE;
  }

  return normalizeVideoEditRecipe(rawRecipe, sourceDurationMs);
}

async function requestCancellationIfPresent(
  jobRef: DocumentReference
): Promise<void> {
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);

    if (!snapshot.exists) {
      return;
    }

    const state = String(snapshot.get('state') ?? '').trim().toUpperCase();

    if (state === 'CANCELLED' || state === 'CANCEL_REQUESTED') {
      return;
    }

    const now = Date.now();
    transaction.set(
      jobRef,
      {
        state: 'CANCEL_REQUESTED',
        cancelRequestedAt: now,
        leaseUntil: null,
        updatedAt: now,
        lastErrorCode: 'VIDEO_DELETED',
        lastError: 'O vídeo foi excluído da plataforma.',
      },
      { merge: true }
    );
  });
}

/**
 * Garante que um upload protegido possua um único job de processamento.
 *
 * O callable de registro usa este caminho de forma síncrona. O trigger abaixo
 * permanece como recuperação para uploads registrados que sofram uma escrita
 * concorrente ou interrupção entre registro e criação do job.
 */
export async function ensurePrivateVideoProcessingQueued(
  rawOwnerUid: unknown,
  rawVideoId: unknown
): Promise<void> {
  const ownerUid = cleanId(rawOwnerUid);
  const videoId = cleanId(rawVideoId);

  if (!ownerUid || !videoId) {
    throw new Error('Identificadores inválidos para fila de processamento.');
  }

  const processingJobId = buildVideoProcessingJobId(ownerUid, videoId);
  const videoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
  const jobRef = processingJobReference(ownerUid, videoId);
  const queuedJob = await db.runTransaction<VideoProcessingJob | null>(
    async (transaction) => {
      const [videoSnap, jobSnap] = await Promise.all([
        transaction.get(videoRef),
        transaction.get(jobRef),
      ]);

      if (!videoSnap.exists) {
        return null;
      }

      const video = videoSnap.data() as PrivateVideoDocument;

      if (String(video.processedStoragePath ?? '').trim()) {
        return null;
      }

      const sourceDurationMs = normalizePositiveInteger(video.durationMs);
      let editRecipe: VideoEditRecipe;

      try {
        editRecipe = resolvePersistedEditRecipe(
          video.editRecipe,
          sourceDurationMs
        );
      } catch (error) {
        const message = error instanceof VideoEditRecipeValidationError
          ? error.message
          : 'A receita de edição persistida não pôde ser validada.';
        const now = Date.now();

        transaction.set(
          videoRef,
          {
            status: 'failed',
            processingStage: 'failed',
            processingErrorCode: INVALID_EDIT_RECIPE_CODE,
            processingErrorMessage: message,
            updatedAt: now,
          },
          { merge: true }
        );

        if (jobSnap.exists) {
          transaction.set(
            jobRef,
            {
              state: 'FAILED',
              completedAt: now,
              leaseUntil: null,
              updatedAt: now,
              lastErrorCode: INVALID_EDIT_RECIPE_CODE,
              lastError: message,
            },
            { merge: true }
          );
        }

        return null;
      }

      if (jobSnap.exists) {
        const existingJob = jobSnap.data() as Partial<VideoProcessingJob>;
        const state = String(existingJob.state ?? '').trim().toUpperCase();
        const expected = statusForExistingJob(state);

        if (
          video.processingJobId !== processingJobId ||
          video.status !== expected.status
        ) {
          transaction.set(
            videoRef,
            {
              processingJobId,
              status: expected.status,
              processingStage: expected.stage,
              editRecipe,
              updatedAt: Date.now(),
            },
            { merge: true }
          );
        }

        return null;
      }

      const sourceStoragePath =
        extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
        extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url);
      const sourcePosterStoragePath =
        extractOwnedPrivateVideoPosterPath(
          ownerUid,
          videoId,
          video.thumbnailPath
        ) ??
        extractOwnedPrivateVideoPosterPath(
          ownerUid,
          videoId,
          video.thumbnailUrl
        );
      const sourceMimeType = normalizeMimeType(video.mimeType);
      const sourceSizeBytes = normalizePositiveInteger(video.sizeBytes);

      if (
        !sourceStoragePath ||
        !ALLOWED_VIDEO_TYPES.has(sourceMimeType) ||
        !sourceSizeBytes ||
        sourceSizeBytes > MAX_VIDEO_SIZE_BYTES ||
        (sourceDurationMs !== null &&
          sourceDurationMs < MIN_VIDEO_DURATION_MS)
      ) {
        if (hasPersistedInvalidProcessingSourceFailure(video)) {
          return null;
        }

        transaction.set(
          videoRef,
          {
            status: 'failed',
            processingStage: 'failed',
            processingErrorCode: INVALID_PROCESSING_SOURCE_CODE,
            processingErrorMessage:
              sourceDurationMs !== null &&
              sourceDurationMs < MIN_VIDEO_DURATION_MS
                ? 'O vídeo precisa ter pelo menos 5 segundos.'
                : 'O arquivo enviado não pôde ser validado para processamento.',
            updatedAt: Date.now(),
          },
          { merge: true }
        );

        return null;
      }

      const now = Date.now();
      const job = buildQueuedVideoProcessingJob({
        ownerUid,
        videoId,
        sourceStoragePath,
        sourcePosterStoragePath,
        sourceMimeType,
        sourceSizeBytes,
        sourceDurationMs,
        editRecipe,
        now,
      });

      transaction.create(jobRef, job);
      transaction.set(
        videoRef,
        {
          processingJobId,
          status: 'queued',
          processingStage: 'queued',
          processingErrorCode: null,
          processingErrorMessage: null,
          editRecipe,
          updatedAt: now,
        },
        { merge: true }
      );

      return job;
    }
  );

  if (queuedJob) {
    await completeVideoProcessingInEmulator(jobRef, queuedJob);
  }
}

export const queuePrivateVideoProcessing = onDocumentWritten(
  {
    document: 'users/{ownerUid}/videos/{videoId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const ownerUid = cleanId(event.params.ownerUid);
    const videoId = cleanId(event.params.videoId);

    if (!ownerUid || !videoId) {
      logger.error('[queuePrivateVideoProcessing] Identificadores inválidos.');
      return;
    }

    if (!event.data?.after.exists) {
      await requestCancellationIfPresent(
        processingJobReference(ownerUid, videoId)
      );
      return;
    }

    const video = event.data.after.data() as PrivateVideoDocument;

    if (!hasProtectedUploadSource(ownerUid, videoId, video)) {
      return;
    }

    await ensurePrivateVideoProcessingQueued(ownerUid, videoId);
  }
);
