import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import {
  getPrivateMediaDraftLimit,
  normalizePrivateMediaDraftUsage,
  PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
} from './private-media-draft.policy';
import {
  deletePrivatePhotoAssetOrQueue,
  processPendingPrivatePhotoAssetCleanupJobs,
} from './private-photo-asset.service';
import {
  cancelPrivateMediaUploadReservationById,
  consumePrivateMediaUploadReservation,
} from './private-media-upload-reservation.handler';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';

interface ReplacePrivatePhotoUploadRequest {
  ownerUid?: unknown;
  photoId?: unknown;
  reservationId?: unknown;
  currentStoragePath?: unknown;
  newStoragePath?: unknown;
  newDisplayUrl?: unknown;
  fileName?: unknown;
  sizeBytes?: unknown;
}

interface ReplacePrivatePhotoUploadResponse {
  photoId: string;
  ownerUid: string;
  previousStoragePath: string;
  storagePath: string;
  displayUrl: string;
  fileName: string;
  sizeBytes: number;
  updatedAt: number;
}

interface PrivatePhotoDocument {
  path?: unknown;
  url?: unknown;
  fileName?: unknown;
  sizeBytes?: unknown;
  updatedAt?: unknown;
  draftReservationActive?: unknown;
  draftReservationId?: unknown;
  lastUploadReservationId?: unknown;
  draftReservedBytes?: unknown;
}

interface PhotoPublicationDocument {
  isPublished?: unknown;
}

const MAX_PHOTO_SIZE_BYTES = 10 * 1024 * 1024;
const DRAFT_USAGE_COLLECTION = 'media_private_draft_usage';
const ALLOWED_PHOTO_TYPES = new Set([
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

  return normalized.trim().slice(0, 160) || 'Foto';
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.trunc(parsed);
}

function normalizeDisplayUrl(value: unknown): string {
  const normalized = String(value ?? '').trim();

  if (!normalized || normalized.length > 2048) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    const localHttp = parsed.protocol === 'http:' && (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1'
    );

    return parsed.protocol === 'https:' || localHttp
      ? parsed.toString()
      : '';
  } catch {
    return '';
  }
}

function timestampToMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }

  const timestamp = value as { toMillis?: () => number } | null | undefined;

  if (typeof timestamp?.toMillis === 'function') {
    return timestamp.toMillis();
  }

  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.getTime();
  }

  return Date.now();
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

async function readPhotoMetadata(storagePath: string): Promise<{
  mimeType: string;
  sizeBytes: number;
  reservationId: string;
}> {
  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) {
    throw new HttpsError(
      'failed-precondition',
      'A nova foto não foi encontrada no armazenamento.'
    );
  }

  const [metadata] = await file.getMetadata();
  const mimeType = String(metadata.contentType ?? '').trim().toLowerCase();
  const sizeBytes = normalizePositiveInteger(metadata.size);
  const reservationId = cleanId(metadata.metadata?.['mediaReservationId']);

  if (!ALLOWED_PHOTO_TYPES.has(mimeType)) {
    throw new HttpsError(
      'failed-precondition',
      'A nova foto possui formato inválido.'
    );
  }

  if (!sizeBytes || sizeBytes > MAX_PHOTO_SIZE_BYTES) {
    throw new HttpsError(
      'failed-precondition',
      'A nova foto está vazia ou excede o limite permitido.'
    );
  }

  if (!reservationId) {
    throw new HttpsError(
      'failed-precondition',
      'A nova foto não possui uma reserva de upload válida.'
    );
  }

  return { mimeType, sizeBytes, reservationId };
}

function buildExistingReplacementResponse(
  ownerUid: string,
  photoId: string,
  reservationId: string,
  previousStoragePath: string,
  newStoragePath: string,
  newDisplayUrl: string,
  metadataSizeBytes: number,
  photo: PrivatePhotoDocument
): ReplacePrivatePhotoUploadResponse | null {
  const registeredPath =
    extractOwnedPrivatePhotoPath(ownerUid, photo.path) ??
    extractOwnedPrivatePhotoPath(ownerUid, photo.url);
  const registeredUrlPath = extractOwnedPrivatePhotoPath(ownerUid, photo.url);
  const registeredReservationId = cleanId(photo.lastUploadReservationId);
  const sizeBytes = normalizePositiveInteger(photo.sizeBytes);

  if (
    registeredPath !== newStoragePath ||
    registeredUrlPath !== newStoragePath ||
    registeredReservationId !== reservationId ||
    sizeBytes !== metadataSizeBytes
  ) {
    return null;
  }

  return {
    photoId,
    ownerUid,
    previousStoragePath,
    storagePath: newStoragePath,
    displayUrl: normalizeDisplayUrl(photo.url) || newDisplayUrl,
    fileName: cleanFileName(photo.fileName),
    sizeBytes,
    updatedAt: timestampToMillis(photo.updatedAt),
  };
}

async function deleteUnregisteredReplacementBestEffort(
  ownerUid: string,
  photoId: string,
  newStoragePath: string
): Promise<void> {
  try {
    const photoSnapshot = await db
      .doc(`users/${ownerUid}/photos/${photoId}`)
      .get();
    const registeredPath = photoSnapshot.exists
      ? extractOwnedPrivatePhotoPath(ownerUid, photoSnapshot.data()?.['path'])
      : null;

    if (registeredPath === newStoragePath) {
      return;
    }

    await storage
      .bucket()
      .file(newStoragePath)
      .delete({ ignoreNotFound: true });
  } catch (error) {
    logger.error('[replacePrivatePhotoUpload] Falha ao limpar nova foto.', {
      ownerUid,
      photoId,
      error: normalizeErrorMessage(error),
    });
  }
}

export const replacePrivatePhotoUpload = onCall<
  ReplacePrivatePhotoUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ReplacePrivatePhotoUploadResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);
    const requestedReservationId = cleanId(request.data?.reservationId);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !photoId || !requestedReservationId) {
      throw new HttpsError('invalid-argument', 'Foto ou reserva inválida.');
    }

    if (requesterUid !== ownerUid) {
      throw new HttpsError(
        'permission-denied',
        'A foto só pode ser substituída no perfil autenticado.'
      );
    }

    const currentStoragePath = extractOwnedPrivatePhotoPath(
      ownerUid,
      request.data?.currentStoragePath
    );
    const newStoragePath = extractOwnedPrivatePhotoPath(
      ownerUid,
      request.data?.newStoragePath
    );
    const newDisplayUrl = normalizeDisplayUrl(request.data?.newDisplayUrl);
    const displayUrlPath = extractOwnedPrivatePhotoPath(
      ownerUid,
      newDisplayUrl
    );

    if (
      !currentStoragePath ||
      !newStoragePath ||
      currentStoragePath === newStoragePath ||
      !newDisplayUrl ||
      displayUrlPath !== newStoragePath
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Os caminhos informados para a substituição são inválidos.'
      );
    }

    let replacementCommitted = false;

    try {
      const metadata = await readPhotoMetadata(newStoragePath);
      const requestedSizeBytes = normalizePositiveInteger(
        request.data?.sizeBytes
      );

      if (metadata.reservationId !== requestedReservationId) {
        throw new HttpsError(
          'failed-precondition',
          'A reserva informada diverge da nova foto armazenada.'
        );
      }

      if (requestedSizeBytes && requestedSizeBytes !== metadata.sizeBytes) {
        throw new HttpsError(
          'failed-precondition',
          'O tamanho informado diverge da nova foto armazenada.'
        );
      }

      const photoRef = db.doc(`users/${ownerUid}/photos/${photoId}`);
      const publicationRef = db.doc(
        `users/${ownerUid}/photo_publications/${photoId}`
      );
      const usageRef = db.collection(DRAFT_USAGE_COLLECTION).doc(ownerUid);
      const updatedAt = Date.now();
      const fileName = cleanFileName(request.data?.fileName);

      const response = await db.runTransaction(
        async (transaction): Promise<ReplacePrivatePhotoUploadResponse> => {
          const [photoSnapshot, publicationSnapshot, usageSnapshot] =
            await Promise.all([
              transaction.get(photoRef),
              transaction.get(publicationRef),
              transaction.get(usageRef),
            ]);

          if (!photoSnapshot.exists) {
            throw new HttpsError('not-found', 'A foto original não existe.');
          }

          const photo = photoSnapshot.data() as PrivatePhotoDocument;
          const existingResponse = buildExistingReplacementResponse(
            ownerUid,
            photoId,
            requestedReservationId,
            currentStoragePath,
            newStoragePath,
            newDisplayUrl,
            metadata.sizeBytes,
            photo
          );

          if (existingResponse) {
            return existingResponse;
          }

          const registeredCurrentPath =
            extractOwnedPrivatePhotoPath(ownerUid, photo.path) ??
            extractOwnedPrivatePhotoPath(ownerUid, photo.url);

          if (registeredCurrentPath !== currentStoragePath) {
            throw new HttpsError(
              'failed-precondition',
              'A foto foi alterada em outro dispositivo. Recarregue antes de editar.'
            );
          }

          const reservation = await consumePrivateMediaUploadReservation(
            transaction,
            {
              reservationId: requestedReservationId,
              ownerUid,
              mediaId: photoId,
              kind: 'photo',
              operation: 'REPLACE',
              sourceStoragePath: newStoragePath,
              auxiliaryStoragePath: null,
              sourceSizeBytes: metadata.sizeBytes,
              auxiliarySizeBytes: 0,
              now: updatedAt,
            }
          );
          const publication = publicationSnapshot.exists
            ? publicationSnapshot.data() as PhotoPublicationDocument
            : null;
          const isPublished = publication?.isPublished === true;
          const reservationActive = photo.draftReservationActive === true;
          const usage = normalizePrivateMediaDraftUsage(
            usageSnapshot.exists ? usageSnapshot.data() : null
          );

          if (!isPublished && reservationActive) {
            const previousReservedBytes =
              normalizePositiveInteger(photo.draftReservedBytes) ?? 0;
            const baselineReservedBytes = Math.max(
              0,
              usage.photoReservedBytes - reservation.reservedUsageBytes
            );
            const nextTotalReservedBytes = Math.max(
              0,
              baselineReservedBytes - previousReservedBytes +
                reservation.draftReservedBytes
            );
            const limit = getPrivateMediaDraftLimit(
              'photo',
              reservation.plan
            );

            if (nextTotalReservedBytes > limit.maxReservedBytes) {
              throw new HttpsError(
                'resource-exhausted',
                'A nova versão ultrapassa o armazenamento temporário disponível para fotos.'
              );
            }

            transaction.set(
              usageRef,
              {
                ...usage,
                photoReservedBytes: nextTotalReservedBytes,
                version: PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
                updatedAt,
              },
              { merge: true }
            );
            transaction.update(photoRef, {
              url: newDisplayUrl,
              path: newStoragePath,
              fileName,
              mimeType: metadata.mimeType,
              sizeBytes: metadata.sizeBytes,
              draftReservationId: reservation.reservationId,
              lastUploadReservationId: reservation.reservationId,
              draftPlanAtReservation: reservation.plan,
              draftReservedBytes: reservation.draftReservedBytes,
              draftUpdatedAt: updatedAt,
              updatedAt: FieldValue.serverTimestamp(),
            });
          } else {
            if (reservation.reservedUsageBytes > 0) {
              transaction.set(
                usageRef,
                {
                  ...usage,
                  photoReservedBytes: Math.max(
                    0,
                    usage.photoReservedBytes - reservation.reservedUsageBytes
                  ),
                  version: PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
                  updatedAt,
                },
                { merge: true }
              );
            }

            transaction.update(photoRef, {
              url: newDisplayUrl,
              path: newStoragePath,
              fileName,
              mimeType: metadata.mimeType,
              sizeBytes: metadata.sizeBytes,
              lastUploadReservationId: reservation.reservationId,
              updatedAt: FieldValue.serverTimestamp(),
            });
          }

          return {
            photoId,
            ownerUid,
            previousStoragePath: currentStoragePath,
            storagePath: newStoragePath,
            displayUrl: newDisplayUrl,
            fileName,
            sizeBytes: metadata.sizeBytes,
            updatedAt,
          };
        }
      );

      replacementCommitted = true;
      await deletePrivatePhotoAssetOrQueue({
        ownerUid,
        photoId,
        storagePath: currentStoragePath,
        reason: 'replace-private-photo',
      });

      return response;
    } catch (error) {
      if (!replacementCommitted) {
        await cancelPrivateMediaUploadReservationById(
          requestedReservationId
        );
        await deleteUnregisteredReplacementBestEffort(
          ownerUid,
          photoId,
          newStoragePath
        );
      }

      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error('[replacePrivatePhotoUpload] Falha ao substituir foto.', {
        ownerUid,
        photoId,
        error: normalizeErrorMessage(error),
      });

      throw new HttpsError(
        'internal',
        'Não foi possível substituir a foto.'
      );
    }
  }
);

export const cleanupPendingPrivatePhotoAssetDeletions = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    await processPendingPrivatePhotoAssetCleanupJobs(100);
  }
);
