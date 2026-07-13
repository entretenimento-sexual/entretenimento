import type { DocumentReference } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { db, getDefaultStorageBucket } from '../../firebaseApp';
import type { VideoProcessingJob } from './video-processing-job';
import { extractOwnedPrivateVideoPathForId } from './video-storage-path';

interface PrivateVideoDocument {
  path?: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
}

interface EmulatorVideoOutput {
  extension: 'mp4' | 'webm';
  mimeType: 'video/mp4' | 'video/webm';
}

function isEnabled(): boolean {
  return process.env.FUNCTIONS_EMULATOR === 'true' &&
    process.env.MEDIA_EMULATOR_AUTO_PROCESS_VIDEOS === 'true';
}

function resolveOutput(mimeType: string): EmulatorVideoOutput | null {
  if (mimeType === 'video/mp4') {
    return { extension: 'mp4', mimeType: 'video/mp4' };
  }

  if (mimeType === 'video/webm') {
    return { extension: 'webm', mimeType: 'video/webm' };
  }

  return null;
}

function normalizePositiveInteger(value: unknown): number | null {
  const normalized = Number(value ?? 0);

  return Number.isFinite(normalized) && normalized > 0
    ? Math.trunc(normalized)
    : null;
}

function privateSourcePath(
  job: VideoProcessingJob,
  video: PrivateVideoDocument
): string | null {
  return extractOwnedPrivateVideoPathForId(
    job.ownerUid,
    job.videoId,
    video.path
  ) ?? extractOwnedPrivateVideoPathForId(
    job.ownerUid,
    job.videoId,
    video.url
  );
}

async function markProcessingFailure(
  jobRef: DocumentReference,
  job: VideoProcessingJob,
  errorCode: string,
  technicalMessage: string,
  userMessage: string
): Promise<void> {
  const now = Date.now();

  await db.runTransaction(async (transaction) => {
    const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
    const [jobSnapshot, videoSnapshot] = await Promise.all([
      transaction.get(jobRef),
      transaction.get(videoRef),
    ]);

    if (!jobSnapshot.exists || jobSnapshot.get('state') !== 'QUEUED') {
      return;
    }

    transaction.update(jobRef, {
      state: 'FAILED',
      providerState: 'EMULATOR_FAILED',
      completedAt: now,
      leaseUntil: null,
      updatedAt: now,
      lastErrorCode: errorCode,
      lastError: technicalMessage,
    });

    if (!videoSnapshot.exists) {
      return;
    }

    const video = videoSnapshot.data() as PrivateVideoDocument;

    if (privateSourcePath(job, video) !== job.sourceStoragePath) {
      return;
    }

    transaction.set(
      videoRef,
      {
        status: 'failed',
        processingStage: 'failed',
        processingErrorCode: errorCode,
        processingErrorMessage: userMessage,
        updatedAt: now,
      },
      { merge: true }
    );
  });

  logger.warn('[emulatorVideoProcessing] Processamento local interrompido.', {
    ownerUid: job.ownerUid,
    videoId: job.videoId,
    errorCode,
    error: technicalMessage,
  });
}

/**
 * Adaptação exclusiva do Firebase Emulator Suite.
 *
 * MP4 e WebM já compatíveis são copiados para o namespace processado e o job é
 * concluído como se o provedor externo tivesse retornado sucesso. MOV continua
 * exigindo transcodificação real e recebe erro explícito no ambiente local.
 */
export async function completeVideoProcessingInEmulator(
  jobRef: DocumentReference,
  job: VideoProcessingJob
): Promise<void> {
  if (!isEnabled()) {
    return;
  }

  const output = resolveOutput(job.sourceMimeType);

  if (!output) {
    await markProcessingFailure(
      jobRef,
      job,
      'EMULATOR_TRANSCODER_UNAVAILABLE',
      `O emulador local não transcodifica ${job.sourceMimeType || 'este formato'}.`,
      'No ambiente local, use MP4 ou WebM para testar a publicação. MOV exige o Transcoder real.'
    );
    return;
  }

  const bucket = getDefaultStorageBucket();
  const sourceFile = bucket.file(job.sourceStoragePath);
  const outputStoragePath =
    `${job.outputPrefix}playback.${output.extension}`;
  const outputFile = bucket.file(outputStoragePath);

  try {
    const [sourceExists] = await sourceFile.exists();

    if (!sourceExists) {
      await markProcessingFailure(
        jobRef,
        job,
        'EMULATOR_SOURCE_NOT_FOUND',
        'O arquivo privado não foi encontrado no Storage Emulator.',
        'O arquivo original não foi encontrado. Exclua este item e envie o vídeo novamente.'
      );
      return;
    }

    await sourceFile.copy(outputFile);
    await outputFile.setMetadata({
      contentType: output.mimeType,
      cacheControl: 'private, max-age=0, no-store, no-transform',
    });

    const [outputMetadata] = await outputFile.getMetadata();
    const outputSizeBytes = normalizePositiveInteger(outputMetadata.size) ??
      job.sourceSizeBytes;
    const now = Date.now();

    const applied = await db.runTransaction(async (transaction) => {
      const videoRef = db.doc(`users/${job.ownerUid}/videos/${job.videoId}`);
      const [jobSnapshot, videoSnapshot] = await Promise.all([
        transaction.get(jobRef),
        transaction.get(videoRef),
      ]);

      if (
        !jobSnapshot.exists ||
        jobSnapshot.get('state') !== 'QUEUED' ||
        !videoSnapshot.exists
      ) {
        return false;
      }

      const video = videoSnapshot.data() as PrivateVideoDocument;

      if (privateSourcePath(job, video) !== job.sourceStoragePath) {
        return false;
      }

      transaction.update(jobRef, {
        state: 'SUCCEEDED',
        attempts: 1,
        externalJobName: `emulator/${job.processingVersion}`,
        providerState: 'EMULATOR_SUCCEEDED',
        outputStoragePath,
        outputMimeType: output.mimeType,
        outputSizeBytes,
        submittedAt: now,
        completedAt: now,
        leaseUntil: null,
        updatedAt: now,
        lastErrorCode: null,
        lastError: null,
      });
      transaction.set(
        videoRef,
        {
          sourceMimeType: video.mimeType ?? job.sourceMimeType,
          sourceSizeBytes: video.sizeBytes ?? job.sourceSizeBytes,
          mimeType: output.mimeType,
          sizeBytes: outputSizeBytes,
          status: 'ready',
          playbackPath: outputStoragePath,
          processedStoragePath: outputStoragePath,
          processedOutputPrefix: job.outputPrefix,
          processedMimeType: output.mimeType,
          processedSizeBytes: outputSizeBytes,
          processingStage: 'ready',
          processingErrorCode: null,
          processingErrorMessage: null,
          processingCompletedAt: now,
          updatedAt: now,
        },
        { merge: true }
      );

      return true;
    });

    if (!applied) {
      await outputFile.delete({ ignoreNotFound: true });
      return;
    }

    logger.info('[emulatorVideoProcessing] Vídeo compatível concluído localmente.', {
      ownerUid: job.ownerUid,
      videoId: job.videoId,
      sourceStoragePath: job.sourceStoragePath,
      outputStoragePath,
      mimeType: output.mimeType,
      sizeBytes: outputSizeBytes,
    });
  } catch (error) {
    await outputFile.delete({ ignoreNotFound: true }).catch(() => undefined);

    const technicalMessage = error instanceof Error
      ? error.message
      : String(error ?? 'Falha desconhecida no processamento local.');

    await markProcessingFailure(
      jobRef,
      job,
      'EMULATOR_PROCESSING_FAILED',
      technicalMessage,
      'Não foi possível preparar o vídeo no ambiente local. Exclua o item e tente o envio novamente.'
    );
  }
}
