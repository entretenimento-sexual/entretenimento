import * as logger from 'firebase-functions/logger';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
import {
  inventoryVideoProcessingOutputs,
  selectDefaultVideoProcessingVariant,
  VIDEO_PROCESSING_PIPELINE_VERSION,
  type VideoProcessingOutputFile,
} from './video-processing-output';
import {
  extractOwnedPrivateVideoPathForId,
  normalizeOwnedProcessedVideoPrefix,
} from './video-storage-path';

interface PrivateVideoDocument {
  path?: unknown;
  url?: unknown;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizeErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error ?? 'unknown'))
    .trim()
    .slice(0, 500);
}

function sourcePath(
  ownerUid: string,
  videoId: string,
  video: PrivateVideoDocument
): string | null {
  return (
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
    extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url)
  );
}

async function listOutputFiles(
  outputPrefix: string
): Promise<VideoProcessingOutputFile[]> {
  const [files] = await storage.bucket().getFiles({ prefix: outputPrefix });

  return Promise.all(files.map(async (file) => {
    const [metadata] = await file.getMetadata();

    return {
      storagePath: file.name,
      contentType: String(metadata.contentType ?? '').trim().toLowerCase(),
      sizeBytes: Number(metadata.size ?? 0),
    };
  }));
}

async function markInvalidOutput(
  jobId: string,
  ownerUid: string,
  videoId: string,
  error: unknown
): Promise<void> {
  const now = Date.now();
  const message = normalizeErrorMessage(error);
  const batch = db.batch();

  batch.set(
    db.collection(VIDEO_PROCESSING_JOBS_COLLECTION).doc(jobId),
    {
      state: 'FAILED',
      completedAt: now,
      updatedAt: now,
      lastErrorCode: 'OUTPUT_INVENTORY_INVALID',
      lastError: message,
    },
    { merge: true }
  );
  batch.set(
    db.doc(`users/${ownerUid}/videos/${videoId}`),
    {
      status: 'failed',
      processingStage: 'failed',
      processingErrorCode: 'OUTPUT_INVENTORY_INVALID',
      processingErrorMessage:
        'O processamento terminou sem gerar versões reproduzíveis do vídeo.',
      updatedAt: now,
    },
    { merge: true }
  );
  await batch.commit();

  logger.error('[videoVariants] Saída de processamento inválida.', {
    ownerUid,
    videoId,
    pipelineVersion: VIDEO_PROCESSING_PIPELINE_VERSION,
    error: message,
  });
}

/**
 * O reconciliador do Transcoder confirma o job e mantém compatibilidade com o
 * campo único legado. Este trigger inventaria todas as variantes canônicas,
 * registra manifests sem expô-los e somente então libera a etapa de entrega.
 */
export const finalizeVideoProcessingVariants = onDocumentWritten(
  {
    document: `${VIDEO_PROCESSING_JOBS_COLLECTION}/{jobId}`,
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    if (!event.data?.after.exists) {
      return;
    }

    const jobId = cleanId(event.params.jobId);
    const job = event.data.after.data() as Partial<VideoProcessingJob>;
    const ownerUid = cleanId(job.ownerUid);
    const videoId = cleanId(job.videoId);
    const state = String(job.state ?? '').trim().toUpperCase();

    if (
      !jobId ||
      !ownerUid ||
      !videoId ||
      state !== 'SUCCEEDED' ||
      (Array.isArray(job.outputVariants) &&
        job.outputVariants.length > 0 &&
        job.pipelineVersion === VIDEO_PROCESSING_PIPELINE_VERSION)
    ) {
      return;
    }

    const outputPrefix = normalizeOwnedProcessedVideoPrefix(
      ownerUid,
      videoId,
      job.outputPrefix
    );
    const expectedSourcePath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      job.sourceStoragePath
    );

    if (!outputPrefix || !expectedSourcePath) {
      await markInvalidOutput(
        jobId,
        ownerUid,
        videoId,
        new Error('Job concluído com paths inválidos.')
      );
      return;
    }

    try {
      const inventory = inventoryVideoProcessingOutputs(
        await listOutputFiles(outputPrefix)
      );
      const defaultVariant = selectDefaultVideoProcessingVariant(inventory);
      const now = Date.now();
      const jobRef = db.collection(VIDEO_PROCESSING_JOBS_COLLECTION).doc(jobId);
      const videoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);

      await db.runTransaction(async (transaction) => {
        const [currentJobSnapshot, videoSnapshot] = await Promise.all([
          transaction.get(jobRef),
          transaction.get(videoRef),
        ]);

        if (!currentJobSnapshot.exists || !videoSnapshot.exists) {
          return;
        }

        const currentJob = currentJobSnapshot.data() as Partial<VideoProcessingJob>;
        const currentState = String(currentJob.state ?? '').trim().toUpperCase();
        const video = videoSnapshot.data() as PrivateVideoDocument;

        if (
          currentState !== 'SUCCEEDED' ||
          sourcePath(ownerUid, videoId, video) !== expectedSourcePath
        ) {
          return;
        }

        transaction.set(
          jobRef,
          {
            pipelineVersion: VIDEO_PROCESSING_PIPELINE_VERSION,
            outputStoragePath: defaultVariant.storagePath,
            outputMimeType: defaultVariant.mimeType,
            outputSizeBytes: defaultVariant.sizeBytes,
            outputVariants: inventory.variants,
            outputDefaultQuality: inventory.defaultQuality,
            hlsManifestStoragePath: inventory.hlsManifestStoragePath,
            dashManifestStoragePath: inventory.dashManifestStoragePath,
            updatedAt: now,
            lastErrorCode: null,
            lastError: null,
          },
          { merge: true }
        );
        transaction.set(
          videoRef,
          {
            mimeType: defaultVariant.mimeType,
            sizeBytes: defaultVariant.sizeBytes,
            status: 'ready',
            playbackPath: defaultVariant.storagePath,
            processedStoragePath: defaultVariant.storagePath,
            processedMimeType: defaultVariant.mimeType,
            processedSizeBytes: defaultVariant.sizeBytes,
            processedVariants: inventory.variants,
            processedDefaultQuality: inventory.defaultQuality,
            processedHlsManifestStoragePath:
              inventory.hlsManifestStoragePath,
            processedDashManifestStoragePath:
              inventory.dashManifestStoragePath,
            processingPipelineVersion: VIDEO_PROCESSING_PIPELINE_VERSION,
            processingStage: 'delivery_ready',
            processingErrorCode: null,
            processingErrorMessage: null,
            processingCompletedAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
      });

      logger.info('[videoVariants] Derivados inventariados.', {
        ownerUid,
        videoId,
        pipelineVersion: VIDEO_PROCESSING_PIPELINE_VERSION,
        variantQualities: inventory.variants.map((variant) => variant.quality),
        hasHlsManifest: !!inventory.hlsManifestStoragePath,
        hasDashManifest: !!inventory.dashManifestStoragePath,
      });
    } catch (error) {
      await markInvalidOutput(jobId, ownerUid, videoId, error);
    }
  }
);
