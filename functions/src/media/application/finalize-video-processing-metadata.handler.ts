import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
import {
  extractOwnedPrivateVideoPathForId,
  normalizeOwnedProcessedVideoPath,
  normalizeOwnedProcessedVideoPrefix,
} from './video-storage-path';

interface PrivateVideoDocument {
  path?: string;
  url?: string;
  processedStoragePath?: string | null;
  sourceMimeType?: string | null;
  sourceSizeBytes?: number | null;
}

const PROCESSED_VIDEO_TYPES = new Set(['video/mp4', 'video/webm']);

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

export const finalizeVideoProcessingMetadata = onDocumentWritten(
  {
    document: `${VIDEO_PROCESSING_JOBS_COLLECTION}/{jobId}`,
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const after = event.data?.after;

    if (!after?.exists) {
      return;
    }

    const job = after.data() as Partial<VideoProcessingJob>;

    if (String(job.state ?? '').trim().toUpperCase() !== 'SUCCEEDED') {
      return;
    }

    const ownerUid = cleanId(job.ownerUid);
    const videoId = cleanId(job.videoId);
    const sourceStoragePath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      job.sourceStoragePath
    );
    const outputStoragePath = normalizeOwnedProcessedVideoPath(
      ownerUid,
      videoId,
      job.outputStoragePath
    );
    const outputPrefix = normalizeOwnedProcessedVideoPrefix(
      ownerUid,
      videoId,
      job.outputPrefix
    );
    const outputMimeType = String(job.outputMimeType ?? '')
      .trim()
      .toLowerCase();
    const outputSizeBytes = normalizePositiveInteger(job.outputSizeBytes);

    if (
      !ownerUid ||
      !videoId ||
      !sourceStoragePath ||
      !outputStoragePath ||
      !outputPrefix ||
      !PROCESSED_VIDEO_TYPES.has(outputMimeType) ||
      !outputSizeBytes
    ) {
      logger.error('[finalizeVideoProcessingMetadata] Job concluído inválido.', {
        jobId: after.id,
        hasOwnerUid: !!ownerUid,
        hasVideoId: !!videoId,
        hasSource: !!sourceStoragePath,
        hasOutput: !!outputStoragePath,
      });
      return;
    }

    const videoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);

    await db.runTransaction(async (transaction) => {
      const videoSnap = await transaction.get(videoRef);

      if (!videoSnap.exists) {
        return;
      }

      const video = videoSnap.data() as PrivateVideoDocument;
      const currentSourcePath =
        extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
        extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url);

      if (currentSourcePath !== sourceStoragePath) {
        return;
      }

      if (video.processedStoragePath === outputStoragePath) {
        return;
      }

      const sourceMimeType = String(
        video.sourceMimeType ?? job.sourceMimeType ?? ''
      )
        .trim()
        .toLowerCase();
      const sourceSizeBytes =
        normalizePositiveInteger(video.sourceSizeBytes) ??
        normalizePositiveInteger(job.sourceSizeBytes);

      transaction.set(
        videoRef,
        {
          sourceMimeType: sourceMimeType || null,
          sourceSizeBytes,
          mimeType: outputMimeType,
          sizeBytes: outputSizeBytes,
          status: 'ready',
          playbackPath: outputStoragePath,
          processedStoragePath: outputStoragePath,
          processedOutputPrefix: outputPrefix,
          processedMimeType: outputMimeType,
          processedSizeBytes: outputSizeBytes,
          processingStage: 'ready',
          processingErrorCode: null,
          processingErrorMessage: null,
          processingCompletedAt:
            normalizePositiveInteger(job.completedAt) ?? Date.now(),
          updatedAt: Date.now(),
        },
        { merge: true }
      );
    });
  }
);
