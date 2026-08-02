import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { assertInteractionAccessData } from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { auth, db, storage } from '../../firebaseApp';
import {
  MAX_VIDEO_CAPTION_SIZE_BYTES,
  VIDEO_CAPTION_MIME_TYPE,
  assertValidWebVttContent,
  normalizeVideoCaptionMetadata,
  type NormalizedVideoCaptionMetadata,
  type VideoCaptionTrackInput,
} from './video-caption-track.policy';
import { ensurePrivateVideoProcessingQueued } from './queue-video-processing.handler';
import {
  registerPrivateVideoUpload as registerPrivateVideoUploadCore,
} from './register-private-video-upload.handler';
import type {
  VideoPublicationSettingsInput,
} from './video-publication-settings';
import {
  extractOwnedPrivateVideoCaptionPath,
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';
import {
  isSupportedVideoUploadMimeType,
  normalizeVideoUploadMimeType,
} from './video-upload-format.policy';
import {
  assertVideoUploadSafetyAttestation,
  type VideoUploadSafetyAttestationInput,
} from './video-upload-safety-attestation';

interface RegisterPrivateVideoUploadRequest
  extends VideoPublicationSettingsInput,
    VideoUploadSafetyAttestationInput,
    VideoCaptionTrackInput {
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
    result?: unknown;
  } | null;
}

interface StoredVideoCaptionTrack extends NormalizedVideoCaptionMetadata {
  storagePath: string;
  mimeType: typeof VIDEO_CAPTION_MIME_TYPE;
  sizeBytes: number;
}

interface RegisteredVideoDocument {
  path?: unknown;
  thumbnailPath?: unknown;
  captionTracks?: unknown;
}

type PrivateUploadAssetKind = 'video' | 'poster' | 'caption';

interface PrivateUploadAsset {
  storagePath: string;
  assetKind: PrivateUploadAssetKind;
}

interface VideoCaptionRegistrationJob {
  ownerUid: string;
  videoId: string;
  track: StoredVideoCaptionTrack;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  attempts: number;
  lastError: string | null;
}

const CLEANUP_COLLECTION = 'media_private_video_upload_cleanup_jobs';
const CAPTION_REGISTRATION_COLLECTION =
  'media_video_caption_registration_jobs';
const CAPTION_REGISTRATION_TTL_MS = 6 * 60 * 60 * 1000;
const CAPTION_RECONCILIATION_BATCH_SIZE = 50;

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

function normalizePositiveInteger(value: unknown): number | null {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.trunc(numeric)
    : null;
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

function captionRegistrationJobId(ownerUid: string, videoId: string): string {
  return createHash('sha256')
    .update(`${ownerUid}:${videoId}`)
    .digest('hex');
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

function normalizeRegisteredCaptionPath(
  ownerUid: string,
  videoId: string,
  value: unknown
): string | null {
  if (!Array.isArray(value)) {
    return null;
  }

  for (const candidate of value) {
    if (typeof candidate !== 'object' || candidate === null) {
      continue;
    }

    const path = extractOwnedPrivateVideoCaptionPath(
      ownerUid,
      videoId,
      (candidate as { storagePath?: unknown }).storagePath
    );

    if (path) {
      return path;
    }
  }

  return null;
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
  let registeredPath: string | null = null;

  if (asset.assetKind === 'video') {
    registeredPath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      video.path
    );
  } else if (asset.assetKind === 'poster') {
    registeredPath = extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      video.thumbnailPath
    );
  } else {
    registeredPath = normalizeRegisteredCaptionPath(
      ownerUid,
      videoId,
      video.captionTracks
    );
  }

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
  const rawCaptionStoragePath = String(data?.captionStoragePath ?? '').trim();
  const captionStoragePath = rawCaptionStoragePath
    ? extractOwnedPrivateVideoCaptionPath(
      ownerUid,
      videoId,
      rawCaptionStoragePath
    )
    : null;

  if (
    (rawPosterStoragePath && !posterStoragePath) ||
    (rawCaptionStoragePath && !captionStoragePath)
  ) {
    return null;
  }

  return [
    { storagePath: videoStoragePath, assetKind: 'video' },
    ...(posterStoragePath
      ? [{ storagePath: posterStoragePath, assetKind: 'poster' as const }]
      : []),
    ...(captionStoragePath
      ? [{ storagePath: captionStoragePath, assetKind: 'caption' as const }]
      : []),
  ];
}

async function validateOptionalCaptionTrack(
  ownerUid: string,
  videoId: string,
  data: RegisterPrivateVideoUploadRequest | undefined
): Promise<StoredVideoCaptionTrack | null> {
  const rawStoragePath = String(data?.captionStoragePath ?? '').trim();

  if (!rawStoragePath) {
    return null;
  }

  const storagePath = extractOwnedPrivateVideoCaptionPath(
    ownerUid,
    videoId,
    rawStoragePath
  );

  if (!storagePath) {
    throw new HttpsError(
      'invalid-argument',
      'O caminho da legenda não pertence ao vídeo informado.'
    );
  }

  const metadata = normalizeVideoCaptionMetadata(data ?? {});
  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new HttpsError(
      'failed-precondition',
      'O arquivo de legenda não foi encontrado.'
    );
  }

  const [fileMetadata] = await file.getMetadata();
  const mimeType = String(fileMetadata.contentType ?? '')
    .trim()
    .toLowerCase();
  const sizeBytes = normalizePositiveInteger(fileMetadata.size);

  if (mimeType !== VIDEO_CAPTION_MIME_TYPE) {
    throw new HttpsError(
      'failed-precondition',
      'A legenda armazenada não possui o formato WebVTT.'
    );
  }

  if (!sizeBytes || sizeBytes > MAX_VIDEO_CAPTION_SIZE_BYTES) {
    throw new HttpsError(
      'failed-precondition',
      'A legenda está vazia ou excede o limite de 1 MB.'
    );
  }

  const [content] = await file.download();
  assertValidWebVttContent(content);

  return {
    ...metadata,
    storagePath,
    mimeType: VIDEO_CAPTION_MIME_TYPE,
    sizeBytes,
  };
}

async function storeCaptionRegistrationJob(
  ownerUid: string,
  videoId: string,
  track: StoredVideoCaptionTrack
): Promise<void> {
  const now = Date.now();
  const job: VideoCaptionRegistrationJob = {
    ownerUid,
    videoId,
    track,
    createdAt: now,
    updatedAt: now,
    expiresAt: now + CAPTION_REGISTRATION_TTL_MS,
    attempts: 0,
    lastError: null,
  };

  await db
    .collection(CAPTION_REGISTRATION_COLLECTION)
    .doc(captionRegistrationJobId(ownerUid, videoId))
    .set(job, { merge: true });
}

async function attachCaptionTrack(
  ownerUid: string,
  videoId: string,
  track: StoredVideoCaptionTrack
): Promise<void> {
  const videoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
  const publicationRef = db.doc(
    `users/${ownerUid}/video_publications/${videoId}`
  );
  const jobRef = db
    .collection(CAPTION_REGISTRATION_COLLECTION)
    .doc(captionRegistrationJobId(ownerUid, videoId));
  const [videoSnapshot, publicationSnapshot] = await Promise.all([
    videoRef.get(),
    publicationRef.get(),
  ]);

  if (!videoSnapshot.exists || !publicationSnapshot.exists) {
    throw new HttpsError(
      'failed-precondition',
      'O vídeo ainda não está disponível para vincular a legenda.'
    );
  }

  const now = Date.now();
  const batch = db.batch();
  batch.set(videoRef, { captionTracks: [track], updatedAt: now }, { merge: true });
  batch.set(
    publicationRef,
    { captionTracks: [track], updatedAt: now },
    { merge: true }
  );
  batch.delete(jobRef);
  await batch.commit();
  await clearCleanupJobBestEffort(track.storagePath);
}

async function cleanupCaptionRegistrationJob(
  jobRef: FirebaseFirestore.DocumentReference,
  job: VideoCaptionRegistrationJob
): Promise<void> {
  await storage
    .bucket()
    .file(job.track.storagePath)
    .delete({ ignoreNotFound: true });
  await jobRef.delete();
}

/**
 * Registra o upload e só responde depois que a fila idempotente foi persistida.
 * O trigger Firestore continua como mecanismo de reconciliação e recuperação.
 * Elegibilidade, formato, declaração de segurança, legenda e intenção de
 * publicação são revalidados no backend antes do processamento.
 */
export const registerPrivateVideoUpload = onCall<
  RegisterPrivateVideoUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RegisteredPrivateVideoResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const requestedMimeType = normalizeVideoUploadMimeType(
      request.data?.mimeType
    );
    const assets = ownerUid && videoId
      ? resolveOwnedUploadAssets(ownerUid, videoId, request.data)
      : null;

    if (requesterUid && requesterUid === ownerUid && assets) {
      if (request.data?.publishWhenReady !== true) {
        await cleanupDeniedUploadAssets(ownerUid, videoId, assets);
        throw new HttpsError(
          'failed-precondition',
          'Todo vídeo enviado deve seguir para processamento e publicação.'
        );
      }

      if (!isSupportedVideoUploadMimeType(requestedMimeType)) {
        await cleanupDeniedUploadAssets(ownerUid, videoId, assets);
        throw new HttpsError(
          'failed-precondition',
          'Envie um vídeo MP4, M4V, MOV ou WebM compatível.'
        );
      }

      try {
        assertVideoUploadSafetyAttestation(request.data);
        await assertPrivateVideoUploadEligibility(ownerUid);
      } catch (error) {
        await cleanupDeniedUploadAssets(ownerUid, videoId, assets);
        throw error;
      }
    }

    let captionTrack: StoredVideoCaptionTrack | null = null;

    try {
      captionTrack = ownerUid && videoId
        ? await validateOptionalCaptionTrack(
          ownerUid,
          videoId,
          request.data
        )
        : null;

      if (captionTrack) {
        await storeCaptionRegistrationJob(ownerUid, videoId, captionTrack);
      }
    } catch (error) {
      if (ownerUid && videoId && assets) {
        await cleanupDeniedUploadAssets(ownerUid, videoId, assets);
      }
      throw error;
    }

    let response: RegisteredPrivateVideoResponse;

    try {
      response = await registerPrivateVideoUploadCore.run(request);
    } catch (error) {
      if (captionTrack && ownerUid && videoId) {
        const jobRef = db
          .collection(CAPTION_REGISTRATION_COLLECTION)
          .doc(captionRegistrationJobId(ownerUid, videoId));
        await cleanupCaptionRegistrationJob(jobRef, {
          ownerUid,
          videoId,
          track: captionTrack,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: Date.now(),
          attempts: 0,
          lastError: null,
        });
      }
      throw error;
    }

    if (captionTrack) {
      await attachCaptionTrack(response.ownerUid, response.videoId, captionTrack);
    }

    await ensurePrivateVideoProcessingQueued(
      response.ownerUid,
      response.videoId
    );

    return response;
  }
);

export const reconcilePendingVideoCaptionRegistrations = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 2,
  },
  async () => {
    const snapshot = await db
      .collection(CAPTION_REGISTRATION_COLLECTION)
      .limit(CAPTION_RECONCILIATION_BATCH_SIZE)
      .get();
    const now = Date.now();

    for (const jobSnapshot of snapshot.docs) {
      const job = jobSnapshot.data() as VideoCaptionRegistrationJob;
      const ownerUid = cleanId(job.ownerUid);
      const videoId = cleanId(job.videoId);
      const storagePath = extractOwnedPrivateVideoCaptionPath(
        ownerUid,
        videoId,
        job.track?.storagePath
      );

      if (!ownerUid || !videoId || !storagePath) {
        logger.error('[videoCaptionRegistration] Job inválido.', {
          jobId: jobSnapshot.id,
        });
        continue;
      }

      try {
        const [videoSnapshot, publicationSnapshot] = await Promise.all([
          db.doc(`users/${ownerUid}/videos/${videoId}`).get(),
          db.doc(`users/${ownerUid}/video_publications/${videoId}`).get(),
        ]);

        if (!videoSnapshot.exists || !publicationSnapshot.exists) {
          if (Number(job.expiresAt ?? 0) <= now) {
            await cleanupCaptionRegistrationJob(jobSnapshot.ref, {
              ...job,
              ownerUid,
              videoId,
              track: { ...job.track, storagePath },
            });
          }
          continue;
        }

        const track = await validateOptionalCaptionTrack(ownerUid, videoId, {
          captionStoragePath: storagePath,
          captionLanguage: job.track.language,
          captionLabel: job.track.label,
        });

        if (!track) {
          throw new Error('A faixa de legenda pendente não pôde ser validada.');
        }

        await attachCaptionTrack(ownerUid, videoId, track);
        await ensurePrivateVideoProcessingQueued(ownerUid, videoId);
      } catch (error) {
        await jobSnapshot.ref.set(
          {
            attempts: Number(job.attempts ?? 0) + 1,
            updatedAt: now,
            lastError: normalizeErrorMessage(error),
          },
          { merge: true }
        );

        logger.warn('[videoCaptionRegistration] Falha na reconciliação.', {
          ownerUid,
          videoId,
          error: normalizeErrorMessage(error),
        });
      }
    }
  }
);
