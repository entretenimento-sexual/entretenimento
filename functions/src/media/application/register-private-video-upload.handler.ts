import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

type RegisteredVideoStatus = 'uploaded' | 'ready';

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

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_POSTER_SIZE_BYTES = 10 * 1024 * 1024;
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

async function deleteUploadedAssetsBestEffort(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (storagePath) => {
      try {
        await storage
          .bucket()
          .file(storagePath)
          .delete({ ignoreNotFound: true });
      } catch (error) {
        logger.warn('[registerPrivateVideoUpload] Falha no rollback físico.', {
          hasStoragePath: !!storagePath,
          error: error instanceof Error ? error.message : String(error ?? ''),
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

    if (!videoStoragePath) {
      throw new HttpsError(
        'invalid-argument',
        'O caminho privado do vídeo não pertence ao upload informado.'
      );
    }

    if (rawPosterStoragePath && !posterStoragePath) {
      await deleteUploadedAssetsBestEffort([videoStoragePath]);
      throw new HttpsError(
        'invalid-argument',
        'O caminho da capa não pertence ao vídeo informado.'
      );
    }

    const rollbackPaths = [
      videoStoragePath,
      ...(posterStoragePath ? [posterStoragePath] : []),
    ];

    try {
      const videoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
      const existingVideo = await videoRef.get();

      if (existingVideo.exists) {
        const existingResponse = buildExistingResponse(
          videoId,
          ownerUid,
          videoStoragePath,
          posterStoragePath,
          existingVideo.data() as RegisteredVideoDocument
        );

        if (existingResponse) {
          return existingResponse;
        }

        throw new HttpsError(
          'already-exists',
          'Este identificador já pertence a outro upload.'
        );
      }

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

      await videoRef.set({
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
      await deleteUploadedAssetsBestEffort(rollbackPaths);

      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error('[registerPrivateVideoUpload] Falha ao registrar upload.', {
        ownerUid,
        videoId,
        error: error instanceof Error ? error.message : String(error ?? ''),
      });

      throw new HttpsError(
        'internal',
        'Não foi possível registrar o vídeo enviado.'
      );
    }
  }
);
