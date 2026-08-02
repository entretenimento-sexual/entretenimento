import { createHash } from 'node:crypto';

import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import {
  applyPrivateMediaDraftReservation,
  calculatePrivateMediaDraftExpiry,
  calculatePrivateMediaDraftReservationBytes,
  evaluatePrivateMediaDraftCapacity,
  normalizePrivateMediaDraftUsage,
  PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION,
  PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
  resolvePrivateMediaDraftPlan,
} from './private-media-draft.policy';
import {
  normalizeVideoPublicationSettings,
  type VideoPublicationSettingsInput,
} from './video-publication-settings';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';
import {
  isAllowedNewVideoUploadMimeType,
  isDirectPublicPlaybackMimeType,
  isRecognizedRegisteredVideoMimeType,
} from './video-upload-format.policy';

type RegisteredVideoStatus = 'uploaded' | 'ready';
type PrivateUploadAssetKind = 'video' | 'poster';

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

interface RegistrationTransactionResult {
  response: RegisterPrivateVideoUploadResponse;
  created: boolean;
}

const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_POSTER_SIZE_BYTES = 10 * 1024 * 1024;
const CLEANUP_COLLECTION = 'media_private_video_upload_cleanup_jobs';
const DRAFT_USAGE_COLLECTION = 'media_private_draft_usage';
const CLEANUP_BATCH_SIZE = 50;
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

function draftReservationId(
  ownerUid: string,
  videoId: string,
  createdAt: number
): string {
  return createHash('sha256')
    .update(`video:${ownerUid}:${videoId}:${createdAt}`)
    .digest('hex');
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

  if (!isAllowedNewVideoUploadMimeType(mimeType)) {
    throw new HttpsError(
      'failed-precondition',
      'Novos vídeos devem estar em MP4/M4V, MOV ou WebM.'
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

async function readOptionalPosterSize(
  storagePath: string | null
): Promise<number> {
  if (!storagePath) {
    return 0;
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

  return sizeBytes;
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

async function isRegisteredAsset(
  ownerUid: string,
  videoId: string,
  storagePath: string,
  assetKind: PrivateUploadAssetKind
): Promise<boolean> {
  const snapshot = await db.doc(`users/${ownerUid}/videos/${videoId}`).get();

  if (!snapshot.exists) {
    return false;
  }

  const video = snapshot.data() as RegisteredVideoDocument;
  const registeredPath = assetKind === 'video'
    ? extractOwnedPrivateVideoPathForId(ownerUid, videoId, video.path)
    : extractOwnedPrivateVideoPosterPath(
      ownerUid,
      videoId,
      video.thumbnailPath
    );

  return registeredPath === storagePath;
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
        if (
          await isRegisteredAsset(
            ownerUid,
            videoId,
            storagePath,
            assetKind
          )
        ) {
          await clearCleanupJobsBestEffort([storagePath]);
          return;
        }

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
    !isRecognizedRegisteredVideoMimeType(mimeType) ||
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

    if (rawPosterStoragePath && !posterStoragePath) {
      await deleteUploadedAssetsRecoverably(ownerUid, videoId, [
        { storagePath: videoStoragePath, assetKind: 'video' },
      ]);
      throw new HttpsError(
        'invalid-argument',
        'O caminho da capa não pertence ao vídeo informado.'
      );
    }

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

    let registrationCommitted = false;
    const rollbackAssets = [
      { storagePath: videoStoragePath, assetKind: 'video' as const },
      ...(posterStoragePath
        ? [{ storagePath: posterStoragePath, assetKind: 'poster' as const }]
        : []),
    ];

    try {
      const [videoMetadata, posterSizeBytes] = await Promise.all([
        readRequiredVideoMetadata(videoStoragePath),
        readOptionalPosterSize(posterStoragePath),
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
        isDirectPublicPlaybackMimeType(videoMetadata.mimeType) && durationMs
          ? 'ready'
          : 'uploaded';
      const createdAt = Date.now();
      const fileName = cleanFileName(request.data?.fileName);
      const publicationSettings = normalizeVideoPublicationSettings(
        request.data,
        {
          title: fileName.replace(/\.[A-Za-z0-9]{2,5}$/, '').slice(0, 120),
          reactionsEnabled: true,
          commentsEnabled: true,
          ratingsEnabled: true,
        }
      );
      const publishWhenReady = request.data?.publishWhenReady === true;
      const videoRef = db.doc(`users/${ownerUid}/videos/${videoId}`);
      const publicationRef = db.doc(
        `users/${ownerUid}/video_publications/${videoId}`
      );
      const userRef = db.doc(`users/${ownerUid}`);
      const usageRef = db.collection(DRAFT_USAGE_COLLECTION).doc(ownerUid);
      const reservedBytes = calculatePrivateMediaDraftReservationBytes(
        'video',
        videoMetadata.sizeBytes,
        posterSizeBytes
      );

      const transactionResult = await db.runTransaction(
        async (transaction): Promise<RegistrationTransactionResult> => {
          const [
            existingVideoSnapshot,
            userSnapshot,
            usageSnapshot,
          ] = await Promise.all([
            transaction.get(videoRef),
            transaction.get(userRef),
            transaction.get(usageRef),
          ]);

          if (existingVideoSnapshot.exists) {
            const concurrentResponse = buildExistingResponse(
              videoId,
              ownerUid,
              videoStoragePath,
              posterStoragePath,
              existingVideoSnapshot.data() as RegisteredVideoDocument
            );

            if (!concurrentResponse) {
              throw new HttpsError(
                'already-exists',
                'Já existe outro vídeo com este identificador.'
              );
            }

            return {
              response: concurrentResponse,
              created: false,
            };
          }

          const plan = resolvePrivateMediaDraftPlan(
            userSnapshot.exists ? userSnapshot.data() : null,
            createdAt
          );
          const usage = normalizePrivateMediaDraftUsage(
            usageSnapshot.exists ? usageSnapshot.data() : null
          );
          const capacity = evaluatePrivateMediaDraftCapacity(
            'video',
            plan,
            usage,
            reservedBytes
          );

          if (!capacity.allowed) {
            const message = capacity.reason === 'ITEM_LIMIT'
              ? 'Você atingiu o limite de rascunhos de vídeos. Publique ou exclua um rascunho antes de enviar outro.'
              : 'Seus rascunhos de vídeos atingiram o limite de armazenamento temporário.';

            throw new HttpsError('resource-exhausted', message);
          }

          const nextUsage = applyPrivateMediaDraftReservation(
            'video',
            usage,
            reservedBytes
          );
          const expiresAt = calculatePrivateMediaDraftExpiry(
            'video',
            plan,
            createdAt
          );
          const reservationId = draftReservationId(
            ownerUid,
            videoId,
            createdAt
          );

          transaction.set(
            usageRef,
            {
              ...nextUsage,
              version: PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
              updatedAt: createdAt,
            },
            { merge: true }
          );
          transaction.create(videoRef, {
            id: videoId,
            ownerUid,
            url: videoStoragePath,
            path: videoStoragePath,
            fileName,
            mimeType: videoMetadata.mimeType,
            sizeBytes: videoMetadata.sizeBytes,
            durationMs,
            thumbnailUrl: posterStoragePath,
            thumbnailPath: posterStoragePath,
            status,
            draftLifecycleVersion: PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION,
            draftLifecycleState: 'ACTIVE',
            draftReservationActive: true,
            draftReservationId: reservationId,
            draftPlanAtReservation: plan,
            draftReservedBytes: reservedBytes,
            draftExpiresAt: expiresAt,
            draftUpdatedAt: createdAt,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          transaction.set(publicationRef, {
            ownerUid,
            videoId,
            isPublished: false,
            publishWhenReady,
            visibility: 'PRIVATE',
            orderIndex: 0,
            moderationStatus: 'PRIVATE',
            moderationReason: null,
            ...publicationSettings,
            createdAt,
            updatedAt: createdAt,
          });

          return {
            response: {
              videoId,
              ownerUid,
              status,
              mimeType: videoMetadata.mimeType,
              sizeBytes: videoMetadata.sizeBytes,
              durationMs,
              videoStoragePath,
              posterStoragePath,
              createdAt,
            },
            created: true,
          };
        }
      );

      registrationCommitted = true;
      await clearCleanupJobsBestEffort(
        rollbackAssets.map((asset) => asset.storagePath)
      );

      if (!transactionResult.created) {
        return transactionResult.response;
      }

      return transactionResult.response;
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
        if (
          await isRegisteredAsset(
            ownerUid,
            videoId,
            storagePath,
            job.assetKind
          )
        ) {
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
