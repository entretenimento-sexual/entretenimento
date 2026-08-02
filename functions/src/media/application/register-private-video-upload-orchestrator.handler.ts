import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertInteractionAccessData } from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { auth, db, storage } from '../../firebaseApp';
import { ensurePrivateVideoProcessingQueued } from './queue-video-processing.handler';
import {
  registerPrivateVideoUpload as registerPrivateVideoUploadCore,
} from './register-private-video-upload.handler';
import type {
  VideoPublicationSettingsInput,
} from './video-publication-settings';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

interface RegisterPrivateVideoUploadRequest
  extends VideoPublicationSettingsInput {
  ownerUid?: string;
  videoId?: string;
  videoStoragePath?: string;
  posterStoragePath?: string | null;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number | null;
  publishWhenReady?: boolean;
}

interface RegisteredPrivateVideoResponse {
  ownerUid: string;
  videoId: string;
  status: 'uploaded' | 'ready';
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  videoStoragePath: string;
  posterStoragePath: string | null;
  createdAt: number;
}

interface PrivateMediaUploadAuthSnapshot {
  disabled?: boolean;
  emailVerified?: boolean;
}

interface PrivateMediaUploadAccountSnapshot {
  uid?: unknown;
  profileCompleted?: unknown;
  accountLocked?: unknown;
  loginAllowed?: unknown;
  accountStatus?: unknown;
  suspended?: unknown;
  interactionBlocked?: unknown;
  ageReverification?: {
    status?: unknown;
  } | null;
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

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function authErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const candidate = error as {
    code?: unknown;
    errorInfo?: { code?: unknown };
  };

  return String(candidate.errorInfo?.code ?? candidate.code ?? '')
    .trim()
    .toLowerCase();
}

function cleanupJobId(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

function assertPrivateVideoUploadEligibilityData(
  authUser: PrivateMediaUploadAuthSnapshot | null | undefined,
  user: PrivateMediaUploadAccountSnapshot | null | undefined,
  expectedUid: string
): void {
  if (!authUser || !user) {
    throw new HttpsError(
      'failed-precondition',
      'Seu perfil não está disponível para enviar vídeos.'
    );
  }

  const documentUid = String(user.uid ?? expectedUid).trim();

  if (documentUid && documentUid !== expectedUid) {
    throw new HttpsError(
      'permission-denied',
      'O perfil informado não corresponde à conta autenticada.'
    );
  }

  if (
    authUser.disabled === true ||
    user.accountLocked === true ||
    user.loginAllowed === false
  ) {
    throw new HttpsError(
      'permission-denied',
      'Sua conta não está disponível para enviar vídeos.'
    );
  }

  assertInteractionAccessData(user);

  if (authUser.emailVerified !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail antes de enviar vídeos.'
    );
  }

  if (user.profileCompleted !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Complete seu perfil antes de enviar vídeos.'
    );
  }
}

async function assertPrivateVideoUploadEligibility(
  ownerUid: string
): Promise<void> {
  try {
    const [authUser, userSnapshot] = await Promise.all([
      auth.getUser(ownerUid),
      db.doc(`users/${ownerUid}`).get(),
    ]);

    assertPrivateVideoUploadEligibilityData(
      {
        disabled: authUser.disabled,
        emailVerified: authUser.emailVerified,
      },
      userSnapshot.exists
        ? userSnapshot.data() as PrivateMediaUploadAccountSnapshot
        : null,
      ownerUid
    );
  } catch (error) {
    if (error instanceof HttpsError) {
      throw error;
    }

    if (authErrorCode(error) === 'auth/user-not-found') {
      throw new HttpsError(
        'failed-precondition',
        'Sua conta não está disponível para enviar vídeos.'
      );
    }

    throw error;
  }
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
 * Registra o upload e só responde depois que a fila idempotente foi persistida.
 * O trigger Firestore continua como mecanismo de reconciliação e recuperação.
 * A elegibilidade é revalidada no backend antes do registro definitivo.
 */
export const registerPrivateVideoUpload = onCall<
  RegisterPrivateVideoUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RegisteredPrivateVideoResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const assets = ownerUid && videoId
      ? resolveOwnedUploadAssets(ownerUid, videoId, request.data)
      : null;

    if (requesterUid && requesterUid === ownerUid && assets) {
      try {
        await assertPrivateVideoUploadEligibility(ownerUid);
      } catch (error) {
        await cleanupDeniedUploadAssets(ownerUid, videoId, assets);
        throw error;
      }
    }

    const response = await registerPrivateVideoUploadCore.run(request);

    await ensurePrivateVideoProcessingQueued(
      response.ownerUid,
      response.videoId
    );

    return response;
  }
);
