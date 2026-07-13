import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

type RegisteredVideoStatus = 'uploaded' | 'ready';
type PrivateUploadAssetKind = 'video' | 'poster';

interface RegisterPrivateVideoUploadRequest {
  ownerUid?: string;
  videoId?: string;
  videoStoragePath?: string;
  posterStoragePath?: string | null;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number | null;
}

interface RegisterPrivateVideoUploadResponse {
  videoId: string;
  ownerUid: string;
  status: RegisteredVideoStatus;
  mimeType: string;
  sizeBytes: number;
  durationMs: number | null;
  videoStoragePath: string;
  posterStoragePath: string | null;
  createdAt: number;
}

interface RegisteredVideoDocument {
  ownerUid?: string;
  path?: string;
  mimeType?: string;
  sizeBytes?: number;
  durationMs?: number | null;
  thumbnailPath?: string | null;
  status?: RegisteredVideoStatus;
  createdAt?: unknown;
}

interface PrivateUploadCleanupJob {
  ownerUid: string;
  videoId: string;
  storagePath: string;
  assetKind: PrivateUploadAssetKind;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  lastError: string | null;
}

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_POSTER_SIZE_BYTES = 10 * 1024 * 1024;
const CLEANUP_COLLECTION = 'media_private_video_upload_cleanup_jobs';
const CLEANUP_BATCH_SIZE = 50;
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
const PUBLIC_PLAYBACK_TYPES = new Set(['video/mp4', 'video/webm']);
const ALLOWED_POSTER_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

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

function cleanFileName(value: unknown): string {
  const raw = String(value ?? '');
  let normalized = '';

  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);

    if (code > 31 && code !== 127) {
      normalized += raw[index];
    }
  }

  return normalized.trim().slice(0, 160) || 'Vídeo';
}

function normalizeMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizePositiveInteger(value: unknown): number | null {
  const numberValue = Number(value ?? 0);

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return null;
  }

  return Math.trunc(numberValue);
}

function timestampToMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  const timestamp = value as { toMillis?: () => number } | null | undefined;

  if (typeof timestamp?.toMillis === 'function') {
    return timestamp.toMillis();
  }

  return Date.now();
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function assertOwner(requesterUid: string | null, ownerUid: string): void {
  if (!requesterUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (requesterUid !== ownerUid) {
    throw new HttpsError(
      'permission-denied',
      'O vídeo só pode ser registrado no perfil autenticado.'
    );
  }
}

function cleanupJobId(storagePath: string): string {
  return createHash('sha256').update(storagePath).digest('hex');
}

function validateCleanupPath(
  ownerUid: string,
  videoId: string,
  storagePath: unknown,
  assetKind: PrivateUploadAssetKind
): string | null {
  return assetKind === 'video'
    ? extractOwnedPrivateVideoPathForId(ownerUid, videoId, storagePath)
    : extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      storagePath
    );
}

async function readRequiredVideoMetadata(storagePath: string): Promise<{
  mimeType: string;
  sizeBytes: number;
}> {
  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new HttpsError(
      'failed-precondition',
      'O arquivo enviado não foi encontrado no armazenamento.'
    );
  }

  const [metadata] = await file.getMetadata();
  const mimeType = normalizeMimeType(metadata.contentType);
  const sizeBytes = normalizePositiveInteger(metadata.size);

  if (!ALLOWED_VIDEO_TYPES.has(mimeType)) {
    throw new HttpsError(
      'failed-precondition',
      'O arquivo armazenado não possui um formato de vídeo permitido.'
    );
  }

  if (!sizeBytes || sizeBytes > MAX_VIDEO_SIZE_BYTES) {
    throw new HttpsError(
      'failed-precondition',
      'O arquivo armazenado excede o limite permitido ou está vazio.'
    );
  }

  return { mimeType, sizeBytes };
}

async function validateOptionalPoster(storagePath: string | null): Promise<void> {
  if (!storagePath) {
    return;
  }

  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new HttpsError(
      'failed-precondition',
      'A imagem de capa do vídeo não foi encontrada.'
    );
  }

  const [metadata] = await file.getMetadata();
  const mimeType = normalizeMimeType(metadata.contentType);
  const sizeBytes = normalizePositiveInteger(metadata.size);

  if (!ALLOWED_POSTER_TYPES.has(mimeType)) {
    throw new HttpsError(
      'failed-precondition',
      'A imagem de capa possui formato inválido.'
    );
  }

  if (!sizeBytes || sizeBytes > MAX_POSTER_SIZE_BYTES) {
    throw new HttpsError(
      'failed-precondition',
      'A imagem de capa excede o limite permitido ou está vazia.'
    );
  }
}

async function enqueueCleanup(
  ownerUid: string,
  videoId: string,
  storagePath: string,
  assetKind: PrivateUploadAssetKind,
  error: unknown
): Promise<void> {
  const now = Date.now();
  const job: PrivateUploadCleanupJob = {
    ownerUid,
    videoId,
    storagePath,
    assetKind,
    createdAt: now,
    updatedAt: now,
    attempts: 1,
    lastError: normalizeErrorMessage(error),
  };

  await db
    .collection(CLEANUP_COLLECTION)
    .doc(cleanupJobId(storagePath))
    .set(job, { merge: true });
}

async function clearCleanupJobsBestEffort(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (storagePath) => {
      try {
        await db
          .collection(CLEANUP_COLLECTION)
          .doc(cleanupJobId(storagePath))
          .delete();
      } catch {
        // O retry agendado também protege objetos já referenciados.
      }
    })
  );
}

async function deleteUploadedAssetsRecoverably(
  ownerUid: string,
  videoId: string,
  assets: Array<{
    storagePath: string;
    assetKind: PrivateUploadAssetKind;
  }>
): Promise<void> {
  await Promise.all(
    assets.map(async ({ storagePath, assetKind }) => {
      try {
        await storage
          .bucket()
          .file(storagePath)
          .delete({ ignoreNotFound: true });
        await clearCleanupJobsBestEffort([storagePath]);
      } catch (error) {
        await enqueueCleanup(
          ownerUid,
          videoId,
          storagePath,
          assetKind,
          error
        );
        logger.warn('[registerPrivateVideoUpload] Limpeza física pendente.', {
          ownerUid,
          videoId,
          assetKind,
          error: normalizeErrorMessage(error),
        });
      }
    })
  );
}

function buildExistingResponse(
  videoId: string,
  ownerUid: string,
  videoStoragePath: string,
  posterStoragePath: string | null,
  existing: RegisteredVideoDocument
): RegisterPrivateVideoUploadResponse | null {
  const existingOwnerUid = cleanId(existing.ownerUid);
  const existingVideoPath = extractOwnedPrivateVideoPathForId(
    ownerUid,
    videoId,
    existing.path
  );
  const existingPosterPath = existing.thumbnailPath
    ? extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      existing.thumbnailPath
    )
    : null;
  const mimeType = normalizeMimeType(existing.mimeType);
  const sizeBytes = normalizePositiveInteger(existing.sizeBytes);
  const status = existing.status === 'ready' ? 'ready' : 'uploaded';

  if (
    existingOwnerUid !== ownerUid ||
    existingVideoPath !== videoStoragePath ||
    existingPosterPath !== posterStoragePath ||
    !ALLOWED_VIDEO_TYPES.has(mimeType) ||
    !sizeBytes
  ) {
    return null;
  }

  return {
    videoId,
    ownerUid,
    status,
    mimeType,
    sizeBytes,
    durationMs: normalizePositiveInteger(existing.durationMs),
    videoStoragePath,
    posterStoragePath,
    createdAt: timestampToMillis(existing.createdAt),
  };
}

function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const withCode = error as { code?: unknown };
  return withCode.code === 6 || String(withCode.code ?? '') === 'already-exists';
}

async function findExistingResponse(
  ownerUid: string,
  videoId: string,
  videoStoragePath: string,
  posterStoragePath: string | null
): Promise<RegisterPrivateVideoUploadResponse | null> {
  const snapshot = await db.doc(`users/${ownerUid}/videos/${videoId}`).get();

  if (!snapshot.exists) {
    return null;
  }

  return buildExistingResponse(
    videoId,
    ownerUid,
    videoStoragePath,
    posterStoragePath,
    snapshot.data() as RegisteredVideoDocument
  );
}

export const registerPrivateVideoUpload = onCall<
  RegisterPrivateVideoUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RegisterPrivateVideoUploadResponse> => {
    const requesterUid = request.auth?.uid ?? null;
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!ownerUid || !videoId) {
      throw new HttpsError('invalid-argument', 'Vídeo inválido.');
    }

    assertOwner(requesterUid, ownerUid);

    const videoStoragePath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      request.data?.videoStoragePath
    );

    if (!videoStoragePath) {
      throw new HttpsError(
        'invalid-argument',
        'O caminho privado do vídeo não pertence ao upload informado.'
      );
    }

    const rawPosterStoragePath = String(
      request.data?.posterStoragePath ?? ''
    ).trim();
    const posterStoragePath = rawPosterStoragePath
      ? extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        rawPosterStoragePath
      )
      : null;
    const existingResponse = await findExistingResponse(
      ownerUid,
      videoId,
      videoStoragePath,
      posterStoragePath
    );

    if (existingResponse) {
      await clearCleanupJobsBestEffort([
        videoStoragePath,
        ...(posterStoragePath ? [posterStoragePath] : []),
      ]);
      return existingResponse;
    }

    if (rawPosterStoragePath && !posterStoragePath) {
      await deleteUploadedAssetsRecoverably(ownerUid, videoId, [
        { storagePath: videoStoragePath, assetKind: 'video' },
      ]);
      throw new HttpsError(
        'invalid-argument',
        'O caminho da capa não pertence ao vídeo informado.'
      );
    }

    let registrationCommitted = false;
    const rollbackAssets = [
      { storagePath: videoStoragePath, assetKind: 'video' as const },
      ...(posterStoragePath
        ? [{ storagePath: posterStoragePath, assetKind: 'poster' as const }]
        : []),
    ];

    try {
      const [videoMetadata] = await Promise.all([
        readRequiredVideoMetadata(videoStoragePath),
        validateOptionalPoster(posterStoragePath),
      ]);
      const requestedMimeType = normalizeMimeType(request.data?.mimeType);
      const requestedSizeBytes = normalizePositiveInteger(
        request.data?.sizeBytes
      );

      if (
        requestedMimeType &&
        requestedMimeType !== videoMetadata.mimeType
      ) {
        throw new HttpsError(
          'failed-precondition',
          'O tipo do arquivo enviado diverge do arquivo armazenado.'
        );
      }

      if (
        requestedSizeBytes &&
        requestedSizeBytes !== videoMetadata.sizeBytes
      ) {
        throw new HttpsError(
          'failed-precondition',
          'O tamanho do arquivo enviado diverge do arquivo armazenado.'
        );
      }

      const durationMs = normalizePositiveInteger(request.data?.durationMs);
      const status: RegisteredVideoStatus =
        PUBLIC_PLAYBACK_TYPES.has(videoMetadata.mimeType) && durationMs
          ? 'ready'
          : 'uploaded';
      const createdAt = Date.now();
      const videoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);

      try {
        await videoRef.create({
          id: videoId,
          ownerUid,
          url: videoStoragePath,
          path: videoStoragePath,
          fileName: cleanFileName(request.data?.fileName),
          mimeType: videoMetadata.mimeType,
          sizeBytes: videoMetadata.sizeBytes,
          durationMs,
          thumbnailUrl: posterStoragePath,
          thumbnailPath: posterStoragePath,
          status,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        });
        registrationCommitted = true;
      } catch (createError) {
        if (isAlreadyExistsError(createError)) {
          const concurrentResponse = await findExistingResponse(
            ownerUid,
            videoId,
            videoStoragePath,
            posterStoragePath
          );

          if (concurrentResponse) {
            registrationCommitted = true;
            await clearCleanupJobsBestEffort(
              rollbackAssets.map((asset) => asset.storagePath)
            );
            return concurrentResponse;
          }
        }

        throw createError;
      }

      await clearCleanupJobsBestEffort(
        rollbackAssets.map((asset) => asset.storagePath)
      );

      return {
        videoId,
        ownerUid,
        status,
        mimeType: videoMetadata.mimeType,
        sizeBytes: videoMetadata.sizeBytes,
        durationMs,
        videoStoragePath,
        posterStoragePath,
        createdAt,
      };
    } catch (error) {
      if (!registrationCommitted) {
        await deleteUploadedAssetsRecoverably(
          ownerUid,
          videoId,
          rollbackAssets
        );
      }

      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error('[registerPrivateVideoUpload] Falha ao registrar upload.', {
        ownerUid,
        videoId,
        error: normalizeErrorMessage(error),
      });

      throw new HttpsError(
        'internal',
        'Não foi possível registrar o vídeo enviado.'
      );
    }
  }
);

export const cleanupPendingPrivateVideoUploadAssets = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const jobsSnapshot = await db
      .collection(CLEANUP_COLLECTION)
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    for (const jobDoc of jobsSnapshot.docs) {
      const job = jobDoc.data() as PrivateUploadCleanupJob;
      const ownerUid = cleanId(job.ownerUid);
      const videoId = cleanId(job.videoId);
      const storagePath = validateCleanupPath(
        ownerUid,
        videoId,
        job.storagePath,
        job.assetKind
      );

      if (!ownerUid || !videoId || !storagePath) {
        logger.error('[privateVideoUploadCleanup] Job inválido.', {
          jobId: jobDoc.id,
        });
        continue;
      }

      try {
        const videoSnapshot = await db
          .doc(`users/${ownerUid}/videos/${videoId}`)
          .get();
        const registeredVideo = videoSnapshot.exists
          ? (videoSnapshot.data() as RegisteredVideoDocument)
          : null;
        const referencedPath = job.assetKind === 'video'
          ? registeredVideo?.path
          : registeredVideo?.thumbnailPath;

        if (referencedPath === storagePath) {
          await jobDoc.ref.delete();
          continue;
        }

        await storage
          .bucket()
          .file(storagePath)
          .delete({ ignoreNotFound: true });
        await jobDoc.ref.delete();
      } catch (error) {
        await jobDoc.ref.set(
          {
            attempts: Number(job.attempts ?? 0) + 1,
            updatedAt: Date.now(),
            lastError: normalizeErrorMessage(error),
          },
          { merge: true }
        );
        logger.warn('[privateVideoUploadCleanup] Falha no retry.', {
          jobId: jobDoc.id,
          ownerUid,
          videoId,
          assetKind: job.assetKind,
          error: normalizeErrorMessage(error),
        });
      }
    }
  }
);
