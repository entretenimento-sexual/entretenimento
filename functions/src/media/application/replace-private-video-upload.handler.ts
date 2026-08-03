import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import {
  cancelPrivateMediaUploadReservationById,
  consumePrivateMediaUploadReservation,
} from './private-media-upload-reservation.handler';
import {
  buildQueuedVideoProcessingJob,
  buildVideoProcessingJobId,
  VIDEO_PROCESSING_JOBS_COLLECTION,
  type VideoProcessingJob,
} from './video-processing-job';
import {
  normalizeVideoEditRecipe,
  type VideoEditRecipe,
} from './video-edit-recipe';
import {
  enqueueImmediateVideoProcessingBestEffort,
} from './video-processing-immediate-task.handler';
import {
  normalizeVideoPublicationSettings,
  type VideoPublicationSettingsInput,
} from './video-publication-settings';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
  normalizeOwnedProcessedVideoPath,
} from './video-storage-path';
import {
  isAllowedNewVideoUploadMimeType,
} from './video-upload-format.policy';

interface ReplacePrivateVideoUploadRequest
  extends VideoPublicationSettingsInput {
  ownerUid?: unknown;
  videoId?: unknown;
  reservationId?: unknown;
  currentStoragePath?: unknown;
  videoStoragePath?: unknown;
  posterStoragePath?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  durationMs?: unknown;
  editRecipe?: unknown;
}

interface ReplacePrivateVideoUploadResponse {
  videoId: string;
  ownerUid: string;
  status: 'queued' | 'processing' | 'ready';
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  videoStoragePath: string;
  posterStoragePath: string | null;
  createdAt: number;
}

interface PrivateVideoDocument {
  ownerUid?: unknown;
  path?: unknown;
  url?: unknown;
  fileName?: unknown;
  mimeType?: unknown;
  sizeBytes?: unknown;
  durationMs?: unknown;
  thumbnailPath?: unknown;
  thumbnailUrl?: unknown;
  playbackPath?: unknown;
  processedStoragePath?: unknown;
  processedOutputPrefix?: unknown;
  processedMimeType?: unknown;
  processedSizeBytes?: unknown;
  status?: unknown;
  replacementState?: unknown;
  lastUploadReservationId?: unknown;
  createdAt?: unknown;
}

interface VideoPublicationDocument extends VideoPublicationSettingsInput {
  isPublished?: unknown;
  moderationStatus?: unknown;
}

interface StoredVideoMetadata {
  mimeType: string;
  sizeBytes: number;
  reservationId: string;
}

interface StoredPosterMetadata {
  sizeBytes: number;
  reservationId: string;
}

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_POSTER_SIZE_BYTES = 10 * 1024 * 1024;
const MIN_VIDEO_DURATION_MS = 5_000;
const ALLOWED_POSTER_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function cleanFileName(value: unknown): string {
  const raw = String(value ?? '');
  let normalized = '';

  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    if (code > 31 && code !== 127) normalized += raw[index];
  }

  return normalized.trim().slice(0, 160) || 'Vídeo';
}

function normalizeMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizePositiveInteger(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.trunc(numberValue)
    : 0;
}

function normalizeOptionalPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const normalized = normalizePositiveInteger(value);
  return normalized > 0 ? normalized : null;
}

function timestampToMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  const timestamp = value as { toMillis?: () => number } | null | undefined;
  return typeof timestamp?.toMillis === 'function'
    ? timestamp.toMillis()
    : Date.now();
}

async function readVideoMetadata(
  storagePath: string
): Promise<StoredVideoMetadata> {
  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new HttpsError(
      'failed-precondition',
      'A nova versão do vídeo não foi encontrada no armazenamento.'
    );
  }

  const [metadata] = await file.getMetadata();
  const mimeType = normalizeMimeType(metadata.contentType);
  const sizeBytes = normalizePositiveInteger(metadata.size);
  const reservationId = cleanId(metadata.metadata?.['mediaReservationId']);

  if (!isAllowedNewVideoUploadMimeType(mimeType)) {
    throw new HttpsError(
      'failed-precondition',
      'A nova versão não possui um formato de vídeo suportado.'
    );
  }

  if (!sizeBytes || sizeBytes > MAX_VIDEO_SIZE_BYTES || !reservationId) {
    throw new HttpsError(
      'failed-precondition',
      'A nova versão não possui metadados de upload válidos.'
    );
  }

  return { mimeType, sizeBytes, reservationId };
}

async function readPosterMetadata(
  storagePath: string | null
): Promise<StoredPosterMetadata | null> {
  if (!storagePath) return null;

  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new HttpsError(
      'failed-precondition',
      'A nova capa do vídeo não foi encontrada.'
    );
  }

  const [metadata] = await file.getMetadata();
  const mimeType = normalizeMimeType(metadata.contentType);
  const sizeBytes = normalizePositiveInteger(metadata.size);
  const reservationId = cleanId(metadata.metadata?.['mediaReservationId']);

  if (
    !ALLOWED_POSTER_TYPES.has(mimeType) ||
    !sizeBytes ||
    sizeBytes > MAX_POSTER_SIZE_BYTES ||
    !reservationId
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A nova capa não possui metadados válidos.'
    );
  }

  return { sizeBytes, reservationId };
}

function normalizeJobState(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function responseFromVideo(
  ownerUid: string,
  videoId: string,
  videoStoragePath: string,
  posterStoragePath: string | null,
  video: PrivateVideoDocument
): ReplacePrivateVideoUploadResponse {
  const status = String(video.status ?? '').trim().toLowerCase();

  return {
    videoId,
    ownerUid,
    status: status === 'ready'
      ? 'ready'
      : status === 'processing'
        ? 'processing'
        : 'queued',
    mimeType: normalizeMimeType(video.mimeType),
    sizeBytes: normalizePositiveInteger(video.sizeBytes),
    durationMs: normalizeOptionalPositiveInteger(video.durationMs),
    videoStoragePath,
    posterStoragePath,
    createdAt: timestampToMillis(video.createdAt),
  };
}

/**
 * Registra uma nova versão privada usando o mesmo `videoId`.
 *
 * A projeção pública anterior não é alterada nesta etapa. Ela permanece
 * disponível até o novo derivado ser processado e promovido com sucesso.
 */
export const replacePrivateVideoUpload = onCall<
  ReplacePrivateVideoUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ReplacePrivateVideoUploadResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const reservationId = cleanId(request.data?.reservationId);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (requesterUid !== ownerUid || !videoId || !reservationId) {
      throw new HttpsError(
        'invalid-argument',
        'Os dados da substituição do vídeo são inválidos.'
      );
    }

    const currentStoragePath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      request.data?.currentStoragePath
    );
    const videoStoragePath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      request.data?.videoStoragePath
    );
    const rawPosterPath = String(request.data?.posterStoragePath ?? '').trim();
    const posterStoragePath = rawPosterPath
      ? extractOwnedPrivateVideoPosterPath(ownerUid, videoId, rawPosterPath)
      : null;

    if (
      !currentStoragePath ||
      !videoStoragePath ||
      currentStoragePath === videoStoragePath ||
      (rawPosterPath && !posterStoragePath)
    ) {
      await cancelPrivateMediaUploadReservationById(reservationId);
      throw new HttpsError(
        'invalid-argument',
        'Os caminhos da substituição do vídeo são inválidos.'
      );
    }

    const [storedVideo, storedPoster] = await Promise.all([
      readVideoMetadata(videoStoragePath),
      readPosterMetadata(posterStoragePath),
    ]);
    const requestedMimeType = normalizeMimeType(request.data?.mimeType);
    const requestedSizeBytes = normalizePositiveInteger(request.data?.sizeBytes);
    const durationMs = normalizeOptionalPositiveInteger(request.data?.durationMs);

    if (
      storedVideo.reservationId !== reservationId ||
      storedVideo.mimeType !== requestedMimeType ||
      storedVideo.sizeBytes !== requestedSizeBytes ||
      (storedPoster && storedPoster.reservationId !== reservationId) ||
      (durationMs !== null && durationMs < MIN_VIDEO_DURATION_MS)
    ) {
      await cancelPrivateMediaUploadReservationById(reservationId);
      throw new HttpsError(
        'failed-precondition',
        'Os arquivos armazenados não correspondem à substituição informada.'
      );
    }

    const editRecipe: VideoEditRecipe = normalizeVideoEditRecipe(
      request.data?.editRecipe,
      durationMs
    );
    const settings = normalizeVideoPublicationSettings(request.data, {
      title: cleanFileName(request.data?.fileName).slice(0, 120),
      reactionsEnabled: true,
      commentsEnabled: true,
      ratingsEnabled: true,
      minimumPlaybackPlan: 'free',
    });
    const fileName = cleanFileName(request.data?.fileName);
    const videoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
    const publicationRef = db.doc(
      `users/${ownerUid}/video_publications/${videoId}`
    );
    const jobRef = db
      .collection(VIDEO_PROCESSING_JOBS_COLLECTION)
      .doc(buildVideoProcessingJobId(ownerUid, videoId));
    const now = Date.now();

    let response: ReplacePrivateVideoUploadResponse;

    try {
      response = await db.runTransaction(async (transaction) => {
        const [videoSnapshot, publicationSnapshot, jobSnapshot] =
          await Promise.all([
            transaction.get(videoRef),
            transaction.get(publicationRef),
            transaction.get(jobRef),
          ]);

        if (!videoSnapshot.exists || !publicationSnapshot.exists) {
          throw new HttpsError(
            'not-found',
            'O vídeo publicado não foi encontrado.'
          );
        }

        const video = videoSnapshot.data() as PrivateVideoDocument;
        const publication =
          publicationSnapshot.data() as VideoPublicationDocument;
        const registeredPath =
          extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path) ??
          extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.url);
        const registeredPosterPath =
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
        const lastReservationId = cleanId(video.lastUploadReservationId);

        if (
          registeredPath === videoStoragePath &&
          lastReservationId === reservationId
        ) {
          return responseFromVideo(
            ownerUid,
            videoId,
            videoStoragePath,
            posterStoragePath,
            video
          );
        }

        const status = String(video.status ?? '').trim().toLowerCase();
        const moderationStatus = String(publication.moderationStatus ?? '')
          .trim()
          .toUpperCase();
        const replacementState = String(video.replacementState ?? '')
          .trim()
          .toUpperCase();
        const existingJob = jobSnapshot.exists
          ? jobSnapshot.data() as Partial<VideoProcessingJob>
          : null;
        const existingJobState = normalizeJobState(existingJob?.state);

        if (
          registeredPath !== currentStoragePath ||
          status !== 'ready' ||
          publication.isPublished !== true ||
          moderationStatus !== 'APPROVED'
        ) {
          throw new HttpsError(
            'failed-precondition',
            'O vídeo mudou ou deixou de estar disponível para substituição.'
          );
        }

        if (
          replacementState === 'PROCESSING' ||
          replacementState === 'REGISTERED' ||
          ['QUEUED', 'SUBMITTING', 'PROCESSING', 'CANCEL_REQUESTED']
            .includes(existingJobState)
        ) {
          throw new HttpsError(
            'failed-precondition',
            'Este vídeo já possui processamento em andamento.'
          );
        }

        const reservation = await consumePrivateMediaUploadReservation(
          transaction,
          {
            reservationId,
            ownerUid,
            mediaId: videoId,
            kind: 'video',
            operation: 'REPLACE',
            sourceStoragePath: videoStoragePath,
            auxiliaryStoragePath: posterStoragePath,
            sourceSizeBytes: storedVideo.sizeBytes,
            auxiliarySizeBytes: storedPoster?.sizeBytes ?? 0,
            now,
          }
        );

        if (reservation.currentStoragePath !== currentStoragePath) {
          throw new HttpsError(
            'failed-precondition',
            'A reserva não corresponde à versão atual do vídeo.'
          );
        }

        const previousProcessedStoragePath =
          normalizeOwnedProcessedVideoPath(
            ownerUid,
            videoId,
            video.processedStoragePath
          ) ??
          normalizeOwnedProcessedVideoPath(
            ownerUid,
            videoId,
            video.playbackPath
          );
        const queuedJob = buildQueuedVideoProcessingJob({
          ownerUid,
          videoId,
          sourceStoragePath: videoStoragePath,
          sourcePosterStoragePath: posterStoragePath,
          sourceMimeType: storedVideo.mimeType,
          sourceSizeBytes: storedVideo.sizeBytes,
          sourceDurationMs: durationMs,
          editRecipe,
          now,
        });

        transaction.set(jobRef, queuedJob);
        transaction.set(
          videoRef,
          {
            ownerUid,
            path: videoStoragePath,
            url: videoStoragePath,
            fileName,
            mimeType: storedVideo.mimeType,
            sizeBytes: storedVideo.sizeBytes,
            sourceMimeType: storedVideo.mimeType,
            sourceSizeBytes: storedVideo.sizeBytes,
            durationMs,
            thumbnailPath: posterStoragePath,
            thumbnailUrl: posterStoragePath,
            editRecipe,
            status: 'queued',
            playbackPath: null,
            processedStoragePath: null,
            processedOutputPrefix: null,
            processedMimeType: null,
            processedSizeBytes: null,
            processingJobId: buildVideoProcessingJobId(ownerUid, videoId),
            processingStage: 'queued',
            processingErrorCode: null,
            processingErrorMessage: null,
            processingCompletedAt: null,
            replacementState: 'PROCESSING',
            replacementRegisteredAt: now,
            replacementPreviousSourceStoragePath: currentStoragePath,
            replacementPreviousPosterStoragePath:
              registeredPosterPath ?? null,
            replacementPreviousProcessedStoragePath:
              previousProcessedStoragePath ?? null,
            replacementPreviousProcessedOutputPrefix:
              String(video.processedOutputPrefix ?? '').trim() || null,
            lastUploadReservationId: reservationId,
            updatedAt: now,
          },
          { merge: true }
        );
        transaction.set(
          publicationRef,
          {
            ...settings,
            publishWhenReady: true,
            autoPublishState: 'WAITING_FOR_PROCESSING',
            autoPublishLeaseUntil: null,
            autoPublishError: null,
            pendingSourceStoragePath: videoStoragePath,
            updatedAt: now,
          },
          { merge: true }
        );

        return {
          videoId,
          ownerUid,
          status: 'queued',
          mimeType: storedVideo.mimeType,
          sizeBytes: storedVideo.sizeBytes,
          durationMs,
          videoStoragePath,
          posterStoragePath,
          createdAt: timestampToMillis(video.createdAt),
        };
      });
    } catch (error) {
      await cancelPrivateMediaUploadReservationById(reservationId)
        .catch(() => undefined);
      throw error;
    }

    await enqueueImmediateVideoProcessingBestEffort(ownerUid, videoId);
    return response;
  }
);
