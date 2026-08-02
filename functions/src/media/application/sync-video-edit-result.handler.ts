import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  hasEffectiveVideoEdit,
  normalizeVideoEditRecipe,
} from './video-edit-recipe';

interface ProcessingJobDocument {
  ownerUid?: unknown;
  videoId?: unknown;
  state?: unknown;
  processingVersion?: unknown;
  sourceDurationMs?: unknown;
  outputDurationMs?: unknown;
  outputWidthPixels?: unknown;
  outputHeightPixels?: unknown;
  editRecipe?: unknown;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function positiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);

  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : null;
}

function isSucceeded(value: unknown): boolean {
  return String(value ?? '').trim().toUpperCase() === 'SUCCEEDED';
}

export const syncVideoEditResult = onDocumentWritten(
  {
    document: 'media_video_processing_jobs/{jobId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    if (!event.data?.after.exists) {
      return;
    }

    const beforeState = event.data.before.exists
      ? event.data.before.get('state')
      : null;
    const after = event.data.after.data() as ProcessingJobDocument;

    if (!isSucceeded(after.state) || isSucceeded(beforeState)) {
      return;
    }

    const ownerUid = cleanId(after.ownerUid);
    const videoId = cleanId(after.videoId);
    const processingVersion = cleanId(after.processingVersion);
    const sourceDurationMs = positiveInteger(after.sourceDurationMs);
    const outputDurationMs = positiveInteger(after.outputDurationMs);
    const outputWidthPixels = positiveInteger(after.outputWidthPixels);
    const outputHeightPixels = positiveInteger(after.outputHeightPixels);

    if (!ownerUid || !videoId || !processingVersion) {
      return;
    }

    const editRecipe = normalizeVideoEditRecipe(
      after.editRecipe,
      sourceDurationMs
    );
    const edited = hasEffectiveVideoEdit(editRecipe, sourceDurationMs);
    const videoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
    const publicVideoRef = db.doc(
      `public_profiles/${ownerUid}/public_videos/${videoId}`
    );
    const now = Date.now();

    await db.runTransaction(async (transaction) => {
      const [videoSnapshot, publicVideoSnapshot] = await Promise.all([
        transaction.get(videoRef),
        transaction.get(publicVideoRef),
      ]);

      if (!videoSnapshot.exists) {
        return;
      }

      const currentJobId = String(
        videoSnapshot.get('processingJobId') ?? ''
      ).trim();

      if (currentJobId && currentJobId !== event.params.jobId) {
        return;
      }

      const patch = {
        editRecipe,
        edited,
        audioMuted: editRecipe.muteAudio,
        orientationMode: editRecipe.orientation,
        ...(outputDurationMs ? { durationMs: outputDurationMs } : {}),
        ...(outputWidthPixels
          ? { processedWidthPixels: outputWidthPixels }
          : {}),
        ...(outputHeightPixels
          ? { processedHeightPixels: outputHeightPixels }
          : {}),
        editProcessingVersion: processingVersion,
        editAppliedAt: now,
        updatedAt: now,
      };

      transaction.set(videoRef, patch, { merge: true });

      if (publicVideoSnapshot.exists) {
        transaction.set(publicVideoRef, patch, { merge: true });
      }
    });
  }
);
