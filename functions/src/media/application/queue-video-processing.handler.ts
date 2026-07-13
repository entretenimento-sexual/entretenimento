import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  buildQueuedVideoProcessingJob,
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
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
  processedStoragePath?: string | null;
  processingJobId?: string | null;
  status?: string;
}

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
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

export const queuePrivateVideoProcessing = onDocumentWritten(
  {
    document: 'users/{ownerUid}/videos/{videoId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const ownerUid = cleanId(event.params.ownerUid);
    const videoId = cleanId(event.params.videoId);

    if (!ownerUid || !videoId) {
      logger.error('[queuePrivateVideoProcessing] Identificadores inválidos.');
      return;
    }

    const processingJobId = buildVideoProcessingJobId(ownerUid, videoId);
    const jobRef = db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .doc(processingJobId);
    const after = event.data?.after;

    if (!after?.exists) {
      await jobRef.set(
        {
          state: 'CANCEL_REQUESTED',
          cancelRequestedAt: Date.now(),
          leaseUntil: null,
          updatedAt: Date.now(),
          lastErrorCode: 'PRIVATE_VIDEO_DELETED',
          lastError: 'O vídeo privado foi excluído.',
        },
        { merge: true }
      );
      return;
    }

    await db.runTransaction(async (transaction) => {
      const [videoSnap, jobSnap] = await Promise.all([
        transaction.get(after.ref),
        transaction.get(jobRef),
      ]);

      if (!videoSnap.exists) {
        return;
      }

      const video = videoSnap.data() as PrivateVideoDocument;

      if (String(video.processedStoragePath ?? '').trim()) {
        return;
      }

      if (jobSnap.exists) {
        const existingJob = jobSnap.data() as Partial<VideoProcessingJob>;
        const state = String(existingJob.state ?? '').trim().toUpperCase();
        const status = state === 'FAILED'
          ? 'failed'
          : state === 'SUCCEEDED'
            ? 'ready'
            : state === 'PROCESSING' || state === 'SUBMITTING'
              ? 'processing'
              : 'queued';

        if (
          video.processingJobId !== processingJobId ||
          video.status !== status
        ) {
          transaction.set(
            videoSnap.ref,
            {
              processingJobId,
              status,
              processingStage: state.toLowerCase() || 'queued',
              updatedAt: Date.now(),
            },
            { merge: true }
          );
        }
        return;
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
      const sourceDurationMs = normalizePositiveInteger(video.durationMs);

      if (
        !sourceStoragePath ||
        !ALLOWED_VIDEO_TYPES.has(sourceMimeType) ||
        !sourceSizeBytes ||
        sourceSizeBytes > MAX_VIDEO_SIZE_BYTES
      ) {
        transaction.set(
          videoSnap.ref,
          {
            status: 'failed',
            processingStage: 'failed',
            processingErrorCode: 'INVALID_PROCESSING_SOURCE',
            processingErrorMessage:
              'O arquivo privado não pôde ser validado para processamento.',
            updatedAt: Date.now(),
          },
          { merge: true }
        );
        return;
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
        now,
      });

      transaction.create(jobRef, job);
      transaction.set(
        videoSnap.ref,
        {
          processingJobId,
          status: 'queued',
          processingStage: 'queued',
          processingErrorCode: null,
          processingErrorMessage: null,
          updatedAt: now,
        },
        { merge: true }
      );
    });
  }
);
