import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import { assertPrivateVideoUploadEligibility } from './private-video-upload-eligibility.service';
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
  videoStoragePath?: string;
  posterStoragePath?: string | null;
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
const VIDEO_UPLOAD_REGISTER_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 12,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 40,
});

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

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
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

/**
 * Registra o arquivo-fonte protegido e só responde depois que a intenção de
 * publicação e a fila idempotente foram persistidas. Não há segundo write de
 * publicação aqui: o core cria a intenção PUBLIC + PENDING_REVIEW atomicamente
 * com o documento do vídeo. Aprovação só ocorre após decisão de moderação.
 */
export const registerPrivateVideoUpload = onCall<
  RegisterPrivateVideoUploadRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request) => {
    assertCallableAppCheck(request.app);

    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const assets = ownerUid && videoId
      ? resolveOwnedUploadAssets(ownerUid, videoId, request.data)
      : null;

    if (requesterUid) {
      await consumeBackendRateLimitQuota({
        action: 'video-upload-register',
        subject: requesterUid,
        config: VIDEO_UPLOAD_REGISTER_RATE_LIMIT,
        message: 'Muitas tentativas de registro de vídeo foram feitas em pouco tempo.',
      });
    }

    if (requesterUid && requesterUid === ownerUid && assets) {
      try {
        await assertPrivateVideoUploadEligibility(ownerUid);
      } catch (error) {
        await cleanupDeniedUploadAssets(ownerUid, videoId, assets);
        throw error;
      }
    }

    const response = (
      await registerPrivateVideoUploadCore.run(request as any)
    ) as RegisteredPrivateVideoResponse;

    await ensurePrivateVideoProcessingQueued(
      response.ownerUid,
      response.videoId
    );

    return response;
  }
);