import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { storage } from '../../firebaseApp';
import type { VideoEditRecipe } from './video-edit-recipe';
import type { VideoProcessingJob } from './video-processing-job';
import { buildRotationSourceStoragePath } from './video-rotation-worker.service';

interface RotationCleanupJobSnapshot {
  ownerUid?: string;
  videoId?: string;
  processingVersion?: string;
  state?: string;
  editRecipe?: Partial<VideoEditRecipe>;
}

function hasRotation(job: RotationCleanupJobSnapshot): boolean {
  const rotationDegrees = Number(job.editRecipe?.rotationDegrees ?? 0);
  return rotationDegrees === 90 ||
    rotationDegrees === 180 ||
    rotationDegrees === 270;
}

function isTerminalOrCancelling(job: RotationCleanupJobSnapshot): boolean {
  const state = String(job.state ?? '').trim().toUpperCase();
  return state === 'SUCCEEDED' ||
    state === 'FAILED' ||
    state === 'CANCELLED' ||
    state === 'CANCEL_REQUESTED';
}

async function deleteRotationSource(job: RotationCleanupJobSnapshot): Promise<void> {
  const storagePath = buildRotationSourceStoragePath(
    job as Pick<VideoProcessingJob, 'ownerUid' | 'videoId' | 'processingVersion'>
  );

  await storage.bucket().file(storagePath).delete({ ignoreNotFound: true });
}

export const cleanupVideoRotationInput = onDocumentWritten(
  {
    document: 'media_video_processing_jobs/{jobId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const before = event.data?.before.exists
      ? event.data.before.data() as RotationCleanupJobSnapshot
      : null;
    const after = event.data?.after.exists
      ? event.data.after.data() as RotationCleanupJobSnapshot
      : null;
    const candidate = after ?? before;

    if (!candidate || !hasRotation(candidate)) {
      return;
    }

    if (after && !isTerminalOrCancelling(after)) {
      return;
    }

    try {
      await deleteRotationSource(candidate);
    } catch (error) {
      logger.warn('[videoRotationCleanup] Temporário de rotação pendente.', {
        jobId: event.params.jobId,
        error: error instanceof Error
          ? error.message.slice(0, 500)
          : String(error ?? 'unknown').slice(0, 500),
      });
    }
  }
);
