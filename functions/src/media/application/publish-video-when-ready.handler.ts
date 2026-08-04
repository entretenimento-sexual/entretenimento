import * as logger from 'firebase-functions/logger';
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  publishVideo as publishVideoCore,
} from './manage-video-publication.handler';
import {
  synchronizePublishedVideoSettings,
} from './sync-published-video-settings.handler';
import {
  hasEffectiveVideoEdit,
  normalizeVideoEditRecipe,
  resolveEditedVideoDurationMs,
  resolveVideoEditGeometry,
} from './video-edit-recipe';
import {
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
} from './video-processing-job';

interface PrivateVideoDoc {
  ownerUid?: unknown;
  status?: unknown;
  processedStoragePath?: unknown;
  processingJobId?: unknown;
}

interface VideoPublicationDoc {
  ownerUid?: unknown;
  videoId?: unknown;
  isPublished?: unknown;
  publishWhenReady?: unknown;
  moderationStatus?: unknown;
  autoPublishState?: unknown;
  autoPublishLeaseUntil?: unknown;
}

interface ProcessingJobDoc {
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

interface PublishVideoResponse {
  videoId: string;
  moderationStatus: string;
  [key: string]: unknown;
}

type DeferredPublicationClaim =
  | 'PUBLISH'
  | 'SYNCHRONIZE'
  | 'SKIPPED';

const AUTO_PUBLISH_LEASE_MS = 2 * 60 * 1000;

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

function isReadyVideo(value: PrivateVideoDoc | null): boolean {
  return String(value?.status ?? '').trim().toLowerCase() === 'ready' &&
    !!String(value?.processedStoragePath ?? '').trim();
}

function normalizeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? 'unknown'))
    .trim()
    .slice(0, 500);
}

async function synchronizeProcessedEditMetadata(
  ownerUid: string,
  videoId: string
): Promise<void> {
  const jobId = buildVideoProcessingJobId(ownerUid, videoId);
  const jobRef = db
    .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
    .doc(jobId);
  const videoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);

  await db.runTransaction(async (transaction) => {
    const [jobSnapshot, videoSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(videoRef),
    ]);

    if (!jobSnapshot.exists || !videoSnapshot.exists) {
      return;
    }

    const job = jobSnapshot.data() as ProcessingJobDoc;
    const video = videoSnapshot.data() as PrivateVideoDoc;
    const state = String(job.state ?? '').trim().toUpperCase();
    const processingVersion = cleanId(job.processingVersion);
    const currentJobId = cleanId(video.processingJobId);

    if (
      state !== 'SUCCEEDED' ||
      !processingVersion ||
      cleanId(job.ownerUid) !== ownerUid ||
      cleanId(job.videoId) !== videoId ||
      (currentJobId && currentJobId !== jobId)
    ) {
      return;
    }

    const sourceDurationMs = positiveInteger(job.sourceDurationMs);
    const editRecipe = normalizeVideoEditRecipe(
      job.editRecipe,
      sourceDurationMs
    );
    const geometry = resolveVideoEditGeometry(editRecipe);
    const outputDurationMs =
      positiveInteger(job.outputDurationMs) ??
      resolveEditedVideoDurationMs(editRecipe, sourceDurationMs);
    const outputWidthPixels =
      positiveInteger(job.outputWidthPixels) ??
      geometry?.outputWidthPixels ??
      null;
    const outputHeightPixels =
      positiveInteger(job.outputHeightPixels) ??
      geometry?.outputHeightPixels ??
      null;
    const now = Date.now();

    transaction.set(
      videoRef,
      {
        editRecipe,
        edited: hasEffectiveVideoEdit(editRecipe, sourceDurationMs),
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
      },
      { merge: true }
    );
  });
}

async function claimDeferredPublication(
  ownerUid: string,
  videoId: string
): Promise<DeferredPublicationClaim> {
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );

  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(publicationRef);

    if (!snapshot.exists) {
      return 'SKIPPED';
    }

    const publication = snapshot.data() as VideoPublicationDoc;

    if (
      cleanId(publication.ownerUid) !== ownerUid ||
      cleanId(publication.videoId) !== videoId ||
      publication.publishWhenReady !== true
    ) {
      return 'SKIPPED';
    }

    const now = Date.now();

    if (
      String(publication.moderationStatus ?? '').trim().toUpperCase() ===
      'REJECTED'
    ) {
      transaction.set(
        publicationRef,
        {
          publishWhenReady: false,
          autoPublishState: 'BLOCKED',
          autoPublishLeaseUntil: null,
          autoPublishError: 'SOURCE_REJECTED',
          updatedAt: now,
        },
        { merge: true }
      );
      return 'SKIPPED';
    }

    if (publication.isPublished === true) {
      transaction.set(
        publicationRef,
        {
          autoPublishState: 'SYNCHRONIZING',
          autoPublishLeaseUntil: now + AUTO_PUBLISH_LEASE_MS,
          autoPublishError: null,
          updatedAt: now,
        },
        { merge: true }
      );
      return 'SYNCHRONIZE';
    }

    const leaseUntil = Number(publication.autoPublishLeaseUntil ?? 0);
    const isClaimed =
      String(publication.autoPublishState ?? '').trim().toUpperCase() ===
        'PUBLISHING' &&
      Number.isFinite(leaseUntil) &&
      leaseUntil > now;

    if (isClaimed) {
      throw new Error('A publicação automática já possui um lease ativo.');
    }

    transaction.set(
      publicationRef,
      {
        autoPublishState: 'PUBLISHING',
        autoPublishLeaseUntil: now + AUTO_PUBLISH_LEASE_MS,
        autoPublishError: null,
        updatedAt: now,
      },
      { merge: true }
    );

    return 'PUBLISH';
  });
}

async function completeDeferredPublication(
  ownerUid: string,
  videoId: string
): Promise<void> {
  await db.doc(`users/${ownerUid}/video_publications/${videoId}`).set(
    {
      publishWhenReady: false,
      autoPublishState: 'COMPLETED',
      autoPublishLeaseUntil: null,
      autoPublishError: null,
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}

async function releaseDeferredPublication(
  ownerUid: string,
  videoId: string,
  error: unknown
): Promise<void> {
  await db.doc(`users/${ownerUid}/video_publications/${videoId}`).set(
    {
      autoPublishState: 'FAILED',
      autoPublishLeaseUntil: null,
      autoPublishError: normalizeErrorMessage(error),
      updatedAt: Date.now(),
    },
    { merge: true }
  );
}

async function publishReadyVideo(
  ownerUid: string,
  videoId: string
): Promise<PublishVideoResponse> {
  return (
    await publishVideoCore.run({
      auth: {
        uid: ownerUid,
        token: {},
      },
      data: {
        ownerUid,
        videoId,
        visibility: 'PUBLIC',
        orderIndex: 0,
      },
      rawRequest: {},
      acceptsStreaming: false,
    } as any)
  ) as PublishVideoResponse;
}

/**
 * Continua a intenção "enviar e publicar" assim que o derivado seguro fica
 * pronto. A publicação continua passando pelas mesmas validações e pela mesma
 * moderação do callable manual.
 */
export const publishVideoWhenReady = onDocumentUpdated(
  {
    document: 'users/{ownerUid}/videos/{videoId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const ownerUid = cleanId(event.params.ownerUid);
    const videoId = cleanId(event.params.videoId);
    const before = event.data?.before.data() as PrivateVideoDoc | undefined;
    const after = event.data?.after.data() as PrivateVideoDoc | undefined;

    if (
      !ownerUid ||
      !videoId ||
      !isReadyVideo(after ?? null) ||
      (isReadyVideo(before ?? null) &&
        String(before?.processedStoragePath ?? '') ===
          String(after?.processedStoragePath ?? ''))
    ) {
      return;
    }

    if (cleanId(after?.ownerUid ?? ownerUid) !== ownerUid) {
      logger.error('[publishVideoWhenReady] Proprietário divergente.', {
        ownerUid,
        videoId,
      });
      return;
    }

    await synchronizeProcessedEditMetadata(ownerUid, videoId);
    const claim = await claimDeferredPublication(ownerUid, videoId);

    if (claim === 'SKIPPED') {
      return;
    }

    try {
      const response = claim === 'PUBLISH'
        ? await publishReadyVideo(ownerUid, videoId)
        : {
          videoId,
          moderationStatus: 'EXISTING',
        };

      await synchronizePublishedVideoSettings(ownerUid, videoId);
      await completeDeferredPublication(ownerUid, videoId);

      logger.info('[publishVideoWhenReady] Publicação automática concluída.', {
        ownerUid,
        videoId,
        resumedSynchronization: claim === 'SYNCHRONIZE',
        moderationStatus: response.moderationStatus,
      });
    } catch (error) {
      await releaseDeferredPublication(ownerUid, videoId, error);
      logger.error('[publishVideoWhenReady] Publicação automática falhou.', {
        ownerUid,
        videoId,
        stage: claim,
        error: normalizeErrorMessage(error),
      });
      throw error;
    }
  }
);
