import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, FieldValue, storage } from '../../firebaseApp';
import {
  applyPrivateMediaDraftReservation,
  evaluatePrivateMediaDraftCapacity,
  normalizePrivateMediaDraftUsage,
  PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION,
  PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
  releasePrivateMediaDraftReservation,
} from './private-media-draft.policy';
import {
  cancelPrivateMediaUploadReservationById,
  consumePrivateMediaUploadReservation,
} from './private-media-upload-reservation.handler';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';

interface RegisterPrivatePhotoUploadRequest {
  ownerUid?: unknown;
  photoId?: unknown;
  reservationId?: unknown;
  storagePath?: unknown;
  displayUrl?: unknown;
  fileName?: unknown;
  sizeBytes?: unknown;
  createdAt?: unknown;
}

interface RegisterPrivatePhotoUploadResponse {
  photoId: string;
  ownerUid: string;
  storagePath: string;
  displayUrl: string;
  fileName: string;
  sizeBytes: number;
  createdAt: number;
  draftExpiresAt: number;
}

interface RegisteredPhotoDocument {
  id?: unknown;
  path?: unknown;
  url?: unknown;
  fileName?: unknown;
  sizeBytes?: unknown;
  createdAt?: unknown;
  draftExpiresAt?: unknown;
  draftReservationId?: unknown;
  lastUploadReservationId?: unknown;
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

function buildExistingResponse(
  ownerUid: string,
  photoId: string,
  reservationId: string,
  storagePath: string,
  displayUrl: string,
  existing: RegisteredPhotoDocument
): RegisterPrivatePhotoUploadResponse | null {
  const existingPath = extractOwnedPrivatePhotoPath(ownerUid, existing.path);
  const existingUrlPath = extractOwnedPrivatePhotoPath(ownerUid, existing.url);
  const existingReservationId = cleanId(
    existing.lastUploadReservationId ?? existing.draftReservationId
  );
  const sizeBytes = normalizePositiveInteger(existing.sizeBytes);

  if (
    cleanId(existing.id ?? photoId) !== photoId ||
    existingReservationId !== reservationId ||
    existingPath !== storagePath ||
    existingUrlPath !== storagePath ||
    !sizeBytes
  ) {
    return null;
  }

  return {
    photoId,
    ownerUid,
    storagePath,
    displayUrl: normalizeDisplayUrl(existing.url) || displayUrl,
    fileName: cleanFileName(existing.fileName),
    sizeBytes,
    createdAt: timestampToMillis(existing.createdAt),
    draftExpiresAt:
      normalizePositiveInteger(existing.draftExpiresAt) ?? Date.now(),
  };
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
      'A foto enviada não foi encontrada no armazenamento.'
    );
  }

  const [metadata] = await file.getMetadata();
  const mimeType = String(metadata.contentType ?? '').trim().toLowerCase();
  const sizeBytes = normalizePositiveInteger(metadata.size);
  const reservationId = cleanId(metadata.metadata?.['mediaReservationId']);

  if (!ALLOWED_PHOTO_TYPES.has(mimeType)) {
    throw new HttpsError(
      'failed-precondition',
      'A foto armazenada possui formato inválido.'
    );
  }

  if (!sizeBytes || sizeBytes > MAX_PHOTO_SIZE_BYTES) {
    throw new HttpsError(
      'failed-precondition',
      'A foto está vazia ou excede o limite permitido.'
    );
  }

  if (!reservationId) {
    throw new HttpsError(
      'failed-precondition',
      'A foto não possui uma reserva de upload válida.'
    );
  }

  return { mimeType, sizeBytes, reservationId };
}

async function deleteUnregisteredPhotoBestEffort(
  ownerUid: string,
  photoId: string,
  storagePath: string
): Promise<void> {
  try {
    const photoSnapshot = await db
      .doc(`users/${ownerUid}/photos/${photoId}`)
      .get();
    const registeredPath = photoSnapshot.exists
      ? extractOwnedPrivatePhotoPath(ownerUid, photoSnapshot.data()?.['path'])
      : null;

    if (registeredPath === storagePath) {
      return;
    }

    await storage
      .bucket()
      .file(storagePath)
      .delete({ ignoreNotFound: true });
  } catch (error) {
    logger.error('[registerPrivatePhotoUpload] Falha ao limpar upload.', {
      ownerUid,
      photoId,
      error: normalizeErrorMessage(error),
    });
  }
}

export const registerPrivatePhotoUpload = onCall<
  RegisterPrivatePhotoUploadRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<RegisterPrivatePhotoUploadResponse> => {
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
        'A foto só pode ser registrada no perfil autenticado.'
      );
    }

    const storagePath = extractOwnedPrivatePhotoPath(
      ownerUid,
      request.data?.storagePath
    );
    const displayUrl = normalizeDisplayUrl(request.data?.displayUrl);
    const displayUrlPath = extractOwnedPrivatePhotoPath(ownerUid, displayUrl);

    if (!storagePath || !displayUrl || displayUrlPath !== storagePath) {
      throw new HttpsError(
        'invalid-argument',
        'A localização privada da foto é inválida.'
      );
    }

    const photoRef = db.doc(`users/${ownerUid}/photos/${photoId}`);
    const existingSnapshot = await photoRef.get();

    if (existingSnapshot.exists) {
      const existing = buildExistingResponse(
        ownerUid,
        photoId,
        requestedReservationId,
        storagePath,
        displayUrl,
        existingSnapshot.data() as RegisteredPhotoDocument
      );

      if (existing) {
        return existing;
      }

      await cancelPrivateMediaUploadReservationById(requestedReservationId);
      await deleteUnregisteredPhotoBestEffort(ownerUid, photoId, storagePath);
      throw new HttpsError(
        'already-exists',
        'Já existe outra foto com este identificador.'
      );
    }

    let registrationCommitted = false;

    try {
      const metadata = await readPhotoMetadata(storagePath);
      const requestedSizeBytes = normalizePositiveInteger(
        request.data?.sizeBytes
      );

      if (metadata.reservationId !== requestedReservationId) {
        throw new HttpsError(
          'failed-precondition',
          'A reserva informada diverge da foto armazenada.'
        );
      }

      if (requestedSizeBytes && requestedSizeBytes !== metadata.sizeBytes) {
        throw new HttpsError(
          'failed-precondition',
          'O tamanho informado diverge da foto armazenada.'
        );
      }

      const createdAt = Date.now();
      const fileName = cleanFileName(request.data?.fileName);
      const usageRef = db.collection(DRAFT_USAGE_COLLECTION).doc(ownerUid);

      const response = await db.runTransaction(
        async (transaction): Promise<RegisterPrivatePhotoUploadResponse> => {
          const [currentPhotoSnapshot, usageSnapshot] = await Promise.all([
            transaction.get(photoRef),
            transaction.get(usageRef),
          ]);

          if (currentPhotoSnapshot.exists) {
            const existing = buildExistingResponse(
              ownerUid,
              photoId,
              requestedReservationId,
              storagePath,
              displayUrl,
              currentPhotoSnapshot.data() as RegisteredPhotoDocument
            );

            if (existing) {
              return existing;
            }

            throw new HttpsError(
              'already-exists',
              'Já existe outra foto com este identificador.'
            );
          }

          const reservation = await consumePrivateMediaUploadReservation(
            transaction,
            {
              reservationId: requestedReservationId,
              ownerUid,
              mediaId: photoId,
              kind: 'photo',
              operation: 'CREATE',
              sourceStoragePath: storagePath,
              auxiliaryStoragePath: null,
              sourceSizeBytes: metadata.sizeBytes,
              auxiliarySizeBytes: 0,
              now: createdAt,
            }
          );
          const usage = normalizePrivateMediaDraftUsage(
            usageSnapshot.exists ? usageSnapshot.data() : null
          );
          const baselineUsage = releasePrivateMediaDraftReservation(
            'photo',
            usage,
            reservation.reservedUsageBytes
          );
          const capacity = evaluatePrivateMediaDraftCapacity(
            'photo',
            reservation.plan,
            baselineUsage,
            reservation.draftReservedBytes
          );

          if (!capacity.allowed) {
            throw new HttpsError(
              'resource-exhausted',
              'A capacidade de rascunhos mudou antes do registro da foto.'
            );
          }

          const nextUsage = applyPrivateMediaDraftReservation(
            'photo',
            baselineUsage,
            reservation.draftReservedBytes
          );
          const draftExpiresAt = reservation.draftExpiresAt ?? createdAt;

          transaction.set(
            usageRef,
            {
              ...nextUsage,
              version: PRIVATE_MEDIA_DRAFT_USAGE_VERSION,
              updatedAt: createdAt,
            },
            { merge: true }
          );
          transaction.create(photoRef, {
            id: photoId,
            ownerUid,
            url: displayUrl,
            path: storagePath,
            fileName,
            mimeType: metadata.mimeType,
            sizeBytes: metadata.sizeBytes,
            draftLifecycleVersion: PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION,
            draftLifecycleState: 'ACTIVE',
            draftReservationActive: true,
            draftReservationId: reservation.reservationId,
            lastUploadReservationId: reservation.reservationId,
            draftPlanAtReservation: reservation.plan,
            draftReservedBytes: reservation.draftReservedBytes,
            draftExpiresAt,
            draftUpdatedAt: createdAt,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });

          return {
            photoId,
            ownerUid,
            storagePath,
            displayUrl,
            fileName,
            sizeBytes: metadata.sizeBytes,
            createdAt,
            draftExpiresAt,
          };
        }
      );

      registrationCommitted = true;
      return response;
    } catch (error) {
      if (!registrationCommitted) {
        await cancelPrivateMediaUploadReservationById(
          requestedReservationId
        );
        await deleteUnregisteredPhotoBestEffort(
          ownerUid,
          photoId,
          storagePath
        );
      }

      if (error instanceof HttpsError) {
        throw error;
      }

      logger.error('[registerPrivatePhotoUpload] Falha ao registrar foto.', {
        ownerUid,
        photoId,
        error: normalizeErrorMessage(error),
      });

      throw new HttpsError(
        'internal',
        'Não foi possível registrar a foto enviada.'
      );
    }
  }
);
