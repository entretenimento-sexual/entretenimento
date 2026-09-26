import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { assertInteractionAccess } from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  IMAGE_INPUT_MIME_TYPES,
  IMAGE_MAX_BYTES,
} from '../media-format.generated';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import {
  PHOTO_UPLOAD_RESERVATION_TTL_MS,
  evaluatePhotoUploadQuota,
} from './photo-upload-reservation.policy';

interface ReservePhotoUploadRequest {
  ownerUid?: unknown;
  storagePath?: unknown;
  sizeBytes?: unknown;
  contentType?: unknown;
}

interface ReservePhotoUploadResponse {
  reservationId: string;
  expiresAt: number;
}

interface PhotoUploadReservationDocument {
  reservationId: string;
  ownerUid: string;
  storagePath: string;
  sizeBytes: number;
  contentType: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

const RESERVATION_COLLECTION = 'media_photo_upload_reservations';
const QUOTA_COLLECTION = 'media_photo_upload_quota';
const CLEANUP_BATCH_SIZE = 400;
const ALLOWED_CONTENT_TYPES = new Set<string>(IMAGE_INPUT_MIME_TYPES);

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (
    !normalized ||
    normalized.length > 128 ||
    normalized.includes('/') ||
    Array.from(normalized).some((character) => {
      const code = character.codePointAt(0);
      return code !== undefined && (code <= 31 || code === 127);
    })
  ) {
    return '';
  }
  return normalized;
}

function normalizeContentType(value: unknown): string {
  const normalized = String(value ?? '').trim().toLowerCase();
  return ALLOWED_CONTENT_TYPES.has(normalized) ? normalized : '';
}

function normalizeSizeBytes(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.trunc(parsed);
}

function buildReservationId(ownerUid: string, storagePath: string): string {
  return createHash('sha256')
    .update(`${ownerUid}:${storagePath}`)
    .digest('hex');
}

function reservationExpiryMs(value: unknown): number {
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    return Number((value as { toMillis: () => number }).toMillis());
  }
  return 0;
}

function sameReservation(
  current: PhotoUploadReservationDocument,
  input: {
    ownerUid: string;
    storagePath: string;
    sizeBytes: number;
    contentType: string;
  }
): boolean {
  return current.ownerUid === input.ownerUid &&
    current.storagePath === input.storagePath &&
    current.sizeBytes === input.sizeBytes &&
    current.contentType === input.contentType;
}

export const reservePhotoUpload = onCall<ReservePhotoUploadRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ReservePhotoUploadResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || ownerUid !== requesterUid) {
      throw new HttpsError(
        'permission-denied',
        'A reserva só pode ser criada para o usuário autenticado.'
      );
    }

    const storagePath = extractOwnedPrivatePhotoPath(
      ownerUid,
      request.data?.storagePath
    );
    const sizeBytes = normalizeSizeBytes(request.data?.sizeBytes);
    const contentType = normalizeContentType(request.data?.contentType);

    if (!storagePath || !contentType || !sizeBytes) {
      throw new HttpsError(
        'invalid-argument',
        'A foto não possui path, formato ou tamanho válidos para reserva.'
      );
    }

    if (sizeBytes > IMAGE_MAX_BYTES) {
      throw new HttpsError(
        'invalid-argument',
        'A foto excede o limite permitido para upload.'
      );
    }

    await assertInteractionAccess(ownerUid);

    const reservationId = buildReservationId(ownerUid, storagePath);
    const reservationRef = db
      .collection(RESERVATION_COLLECTION)
      .doc(reservationId);
    const quotaRef = db.collection(QUOTA_COLLECTION).doc(ownerUid);
    const nowMs = Date.now();

    return db.runTransaction(async (transaction) => {
      const reservationSnapshot = await transaction.get(reservationRef);

      if (reservationSnapshot.exists) {
        const current = reservationSnapshot.data() as
          PhotoUploadReservationDocument;
        const expiresAtMs = reservationExpiryMs(current.expiresAt);

        if (
          expiresAtMs > nowMs &&
          sameReservation(current, {
            ownerUid,
            storagePath,
            sizeBytes,
            contentType,
          })
        ) {
          return { reservationId, expiresAt: expiresAtMs };
        }

        if (expiresAtMs > nowMs) {
          throw new HttpsError(
            'already-exists',
            'Já existe uma reserva ativa incompatível para este upload.'
          );
        }
      }

      const quotaSnapshot = await transaction.get(quotaRef);
      const quotaDecision = evaluatePhotoUploadQuota(
        quotaSnapshot.exists ? quotaSnapshot.data() : null,
        sizeBytes,
        nowMs
      );

      if (!quotaDecision.allowed) {
        throw new HttpsError(
          'resource-exhausted',
          'O limite temporário de uploads de fotos foi atingido. Tente novamente mais tarde.',
          {
            reason: quotaDecision.reason,
            retryAfterMs: quotaDecision.retryAfterMs,
          }
        );
      }

      const expiresAtMs = nowMs + PHOTO_UPLOAD_RESERVATION_TTL_MS;
      const reservation: PhotoUploadReservationDocument = {
        reservationId,
        ownerUid,
        storagePath,
        sizeBytes,
        contentType,
        createdAt: Timestamp.fromMillis(nowMs),
        expiresAt: Timestamp.fromMillis(expiresAtMs),
      };

      transaction.set(quotaRef, {
        ...quotaDecision.nextState,
        updatedAt: nowMs,
      });
      transaction.set(reservationRef, reservation);

      return { reservationId, expiresAt: expiresAtMs };
    });
  }
);

export const cleanupExpiredPhotoUploadReservations = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 24 hours',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const snapshot = await db
      .collection(RESERVATION_COLLECTION)
      .where('expiresAt', '<=', Timestamp.now())
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    if (snapshot.empty) return;

    const batch = db.batch();
    snapshot.docs.forEach((documentSnapshot) => {
      batch.delete(documentSnapshot.ref);
    });
    await batch.commit();
  }
);
