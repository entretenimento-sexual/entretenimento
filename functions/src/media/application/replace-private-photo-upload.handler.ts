import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import {
  calculatePrivateMediaDraftReservationBytes,
  getPrivateMediaDraftLimit,
  normalizePrivateMediaDraftUsage,
  PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
  resolvePrivateMediaDraftPlan,
} from './private-media-draft.policy';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';

interface ReplacePrivatePhotoUploadRequest {
  ownerUid?: unknown;
  photoId?: unknown;
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
  draftReservationActive?: unknown;
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

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

async function readPhotoMetadata(storagePath: string): Promise<{
  mimeType: string;
  sizeBytes: number;
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

  return { mimeType, sizeBytes };
}

async function deleteNewPhotoBestEffort(storagePath: string): Promise<void> {
  try {
    await storage
      .bucket()
      .file(storagePath)
      .delete({ ignoreNotFound: true });
  } catch (error) {
    logger.error('[replacePrivatePhotoUpload] Falha ao limpar nova foto.', {
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

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || !photoId) {
      throw new HttpsError('invalid-argument', 'Foto inválida.');
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
      const userRef = db.doc(`users/${ownerUid}`);
      const usageRef = db.collection(DRAFT_USAGE_COLLECTION).doc(ownerUid);
      const updatedAt = Date.now();
      const fileName = cleanFileName(request.data?.fileName);
      const newReservedBytes = calculatePrivateMediaDraftReservationBytes(
        'photo',
        metadata.sizeBytes
      );

      const response = await db.runTransaction(
        async (transaction): Promise<ReplacePrivatePhotoUploadResponse> => {
          const [
            photoSnapshot,
            publicationSnapshot,
            userSnapshot,
            usageSnapshot,
          ] = await Promise.all([
            transaction.get(photoRef),
            transaction.get(publicationRef),
            transaction.get(userRef),
            transaction.get(usageRef),
          ]);

          if (!photoSnapshot.exists) {
            throw new HttpsError('not-found', 'A foto original não existe.');
          }

          const photo = photoSnapshot.data() as PrivatePhotoDocument;
          const registeredCurrentPath =
            extractOwnedPrivatePhotoPath(ownerUid, photo.path) ??
            extractOwnedPrivatePhotoPath(ownerUid, photo.url);

          if (registeredCurrentPath !== currentStoragePath) {
            throw new HttpsError(
              'failed-precondition',
              'A foto foi alterada em outro dispositivo. Recarregue antes de editar.'
            );
          }

          const publication = publicationSnapshot.exists
            ? publicationSnapshot.data() as PhotoPublicationDocument
            : null;
          const isPublished = publication?.isPublished === true;
          const reservationActive = photo.draftReservationActive === true;

          if (!isPublished && reservationActive) {
            const usage = normalizePrivateMediaDraftUsage(
              usageSnapshot.exists ? usageSnapshot.data() : null
            );
            const previousReservedBytes =
              normalizePositiveInteger(photo.draftReservedBytes) ?? 0;
            const nextTotalReservedBytes = Math.max(
              0,
              usage.photoReservedBytes - previousReservedBytes +
                newReservedBytes
            );
            const plan = resolvePrivateMediaDraftPlan(
              userSnapshot.exists ? userSnapshot.data() : null,
              updatedAt
            );
            const limit = getPrivateMediaDraftLimit('photo', plan);
            const increasesReservation =
              newReservedBytes > previousReservedBytes;

            if (
              increasesReservation &&
              nextTotalReservedBytes > limit.maxReservedBytes
            ) {
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
              draftPlanAtReservation: plan,
              draftReservedBytes: newReservedBytes,
              draftUpdatedAt: updatedAt,
              updatedAt: FieldValue.serverTimestamp(),
            });
          } else {
            transaction.update(photoRef, {
              url: newDisplayUrl,
              path: newStoragePath,
              fileName,
              mimeType: metadata.mimeType,
              sizeBytes: metadata.sizeBytes,
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
      return response;
    } catch (error) {
      if (!replacementCommitted) {
        await deleteNewPhotoBestEffort(newStoragePath);
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
