import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import { assertPrivateVideoUploadEligibility } from './private-video-upload-eligibility.service';
import {
  assertPrivateVideoUploadReservation,
  consumePrivateVideoUploadReservationAfterRegistration,
  type PrivateVideoReservationRegistrationInput,
} from './private-video-upload-reservation-registration.service';
import {
  cancelPrivateVideoUploadReservationById,
} from './private-video-upload-reservation.handler';
import { ensurePrivateVideoProcessingQueued } from './queue-video-processing.handler';
import {
  registerPrivateVideoUpload as registerPrivateVideoUploadCore,
} from './register-private-video-upload.handler';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

interface RegisterPrivateVideoUploadRequest {
  ownerUid?: string;
  videoId?: string;
  reservationId?: string;
  videoStoragePath?: string;
  posterStoragePath?: string | null;
  sizeBytes?: number;
  mimeType?: string;
  [key: string]: unknown;
}

interface RegisteredPrivateVideoResponse {
  ownerUid: string;
  videoId: string;
  [key: string]: unknown;
}

interface RegisteredVideoDocument {
  path?: unknown;
  thumbnailPath?: unknown;
}

type PrivateUploadAssetKind = 'video' | 'poster';

interface PrivateUploadAsset {
  storagePath: string;
  assetKind: PrivateUploadAssetKind;
}

const CLEANUP_COLLECTION = 'media_private_video_upload_cleanup_jobs';

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 31 || code === 127) {
      return true;
    }
  }

  return false;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    containsControlCharacter(normalized)
  ) {
    return '';
  }

  return normalized;
}

function normalizePositiveInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizeMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function cleanupJobId(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

async function isRegisteredAsset(
  ownerUid: string,
  videoId: string,
  asset: PrivateUploadAsset
): Promise<boolean> {
  const snapshot = await db.doc(`users/${ownerUid}/videos/${videoId}`).get();

  if (!snapshot.exists) {
    return false;
  }

  const video = snapshot.data() as RegisteredVideoDocument;
  const registeredPath = asset.assetKind === 'video'
    ? extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path)
    : extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      video.thumbnailPath
    );

  return registeredPath === asset.storagePath;
}

async function clearCleanupJobBestEffort(storagePath: string): Promise<void> {
  try {
    await db
      .collection(CLEANUP_COLLECTION)
      .doc(cleanupJobId(storagePath))
      .delete();
  } catch {
    // O retry agendado também remove jobs de objetos já resolvidos.
  }
}

async function enqueueCleanup(
  ownerUid: string,
  videoId: string,
  asset: PrivateUploadAsset,
  error: unknown
): Promise<void> {
  const now = Date.now();

  await db
    .collection(CLEANUP_COLLECTION)
    .doc(cleanupJobId(asset.storagePath))
    .set(
      {
        ownerUid,
        videoId,
        storagePath: asset.storagePath,
        assetKind: asset.assetKind,
        createdAt: now,
        updatedAt: now,
        attempts: 1,
        lastError: normalizeErrorMessage(error),
      },
      { merge: true }
    );
}

async function cleanupDeniedUploadAssets(
  ownerUid: string,
  videoId: string,
  assets: PrivateUploadAsset[]
): Promise<void> {
  await Promise.all(
    assets.map(async (asset) => {
      try {
        if (await isRegisteredAsset(ownerUid, videoId, asset)) {
          await clearCleanupJobBestEffort(asset.storagePath);
          return;
        }

        await storage
          .bucket()
          .file(asset.storagePath)
          .delete({ ignoreNotFound: true });
        await clearCleanupJobBestEffort(asset.storagePath);
      } catch (error) {
        await enqueueCleanup(ownerUid, videoId, asset, error);
        logger.warn(
          '[registerPrivateVideoUpload] Limpeza após negação pendente.',
          {
            ownerUid,
            videoId,
            assetKind: asset.assetKind,
            error: normalizeErrorMessage(error),
          }
        );
      }
    })
  );
}

function resolveOwnedUploadAssets(
  ownerUid: string,
  videoId: string,
  data: RegisterPrivateVideoUploadRequest | undefined
): PrivateUploadAsset[] | null {
  const videoStoragePath = extractOwnedPrivateVideoPathForId(
    ownerUid,
    videoId,
    data?.videoStoragePath
  );

  if (!videoStoragePath) {
    return null;
  }

  const rawPosterStoragePath = String(data?.posterStoragePath ?? '').trim();
  const posterStoragePath = rawPosterStoragePath
    ? extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      rawPosterStoragePath
    )
    : null;

  if (rawPosterStoragePath && !posterStoragePath) {
    return null;
  }

  return [
    { storagePath: videoStoragePath, assetKind: 'video' },
    ...(posterStoragePath
      ? [{ storagePath: posterStoragePath, assetKind: 'poster' as const }]
      : []),
  ];
}

function buildReservationInput(
  ownerUid: string,
  videoId: string,
  data: RegisterPrivateVideoUploadRequest | undefined
): PrivateVideoReservationRegistrationInput | null {
  const reservationId = cleanId(data?.reservationId);
  const videoStoragePath = extractOwnedPrivateVideoPathForId(
    ownerUid,
    videoId,
    data?.videoStoragePath
  );
  const rawPosterStoragePath = String(data?.posterStoragePath ?? '').trim();
  const posterStoragePath = rawPosterStoragePath
    ? extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      rawPosterStoragePath
    )
    : null;
  const videoSizeBytes = normalizePositiveInteger(data?.sizeBytes);
  const mimeType = normalizeMimeType(data?.mimeType);

  if (
    !reservationId ||
    !videoStoragePath ||
    (rawPosterStoragePath && !posterStoragePath) ||
    !videoSizeBytes ||
    !mimeType
  ) {
    return null;
  }

  return {
    reservationId,
    ownerUid,
    videoId,
    videoStoragePath,
    posterStoragePath,
    videoSizeBytes,
    mimeType,
  };
}

/**
 * Registra o upload e só responde depois que a fila idempotente foi persistida.
 * O trigger Firestore continua como mecanismo de reconciliação e recuperação.
 * A elegibilidade e a reserva são revalidadas antes do registro definitivo.
 */
export const registerPrivateVideoUpload = onCall<
  RegisterPrivateVideoUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const reservationId = cleanId(request.data?.reservationId);
    const assets = ownerUid && videoId
      ? resolveOwnedUploadAssets(ownerUid, videoId, request.data)
      : null;
    const reservationInput = ownerUid && videoId
      ? buildReservationInput(ownerUid, videoId, request.data)
      : null;

    if (
      requesterUid &&
      requesterUid === ownerUid &&
      assets &&
      reservationInput
    ) {
      try {
        await assertPrivateVideoUploadReservation(reservationInput);
      } catch (error) {
        await cleanupDeniedUploadAssets(ownerUid, videoId, assets);
        throw error;
      }

      try {
        await assertPrivateVideoUploadEligibility(ownerUid);
      } catch (error) {
        const released = await cancelPrivateVideoUploadReservationById(
          reservationId,
          ownerUid
        );

        if (!released) {
          await cleanupDeniedUploadAssets(ownerUid, videoId, assets);
        }

        throw error;
      }
    }

    const requestWithRequiredPublication = {
      ...request,
      data: {
        ...(request.data ?? {}),
        publishWhenReady: true,
      },
    };
    const response = (
      await registerPrivateVideoUploadCore.run(
        requestWithRequiredPublication as any
      )
    ) as RegisteredPrivateVideoResponse;

    if (reservationInput) {
      try {
        await consumePrivateVideoUploadReservationAfterRegistration(
          reservationInput
        );
      } catch (error) {
        logger.warn(
          '[registerPrivateVideoUpload] Reconciliação da reserva pendente.',
          {
            ownerUid: response.ownerUid,
            videoId: response.videoId,
            reservationId,
            error: normalizeErrorMessage(error),
          }
        );
      }
    }

    await ensurePrivateVideoProcessingQueued(
      response.ownerUid,
      response.videoId
    );

    return response;
  }
);
