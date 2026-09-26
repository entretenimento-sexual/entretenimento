import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { assertInteractionAccess } from '../../account_lifecycle/interaction-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, getDefaultStorageBucket } from '../../firebaseApp';
import {
  IMAGE_INPUT_MIME_TYPES,
  IMAGE_MAX_BYTES,
} from '../media-format.generated';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';
import {
  PHOTO_CLEANUP_MAX_ATTEMPTS,
  nextPhotoCleanupRetry,
} from './photo-cleanup-job.policy';
import { logPhotoOperation } from './photo-operation-telemetry';
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
  cleanupAttempts?: number;
  cleanupLastError?: string | null;
}

const RESERVATION_COLLECTION = 'media_photo_upload_reservations';
const QUOTA_COLLECTION = 'media_photo_upload_quota';
const CLEANUP_BATCH_SIZE = 100;
const CLEANUP_CONCURRENCY = 8;
const DEAD_LETTER_COLLECTION = 'media_photo_upload_cleanup_dead_letters';
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

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }
  return String(error ?? 'unknown').slice(0, 500);
}

async function hasCanonicalPhotoReference(
  reservation: PhotoUploadReservationDocument
): Promise<boolean> {
  const snapshot = await db
    .collection(`users/${reservation.ownerUid}/photos`)
    .where('path', '==', reservation.storagePath)
    .limit(1)
    .get();

  return !snapshot.empty;
}

async function moveReservationCleanupToDeadLetter(
  documentSnapshot: FirebaseFirestore.QueryDocumentSnapshot,
  reservation: PhotoUploadReservationDocument,
  error: unknown
): Promise<void> {
  const now = Date.now();
  const batch = db.batch();
  batch.set(
    db.collection(DEAD_LETTER_COLLECTION).doc(documentSnapshot.id),
    {
      reservationId: documentSnapshot.id,
      ownerUid: reservation.ownerUid,
      storagePath: reservation.storagePath,
      sizeBytes: reservation.sizeBytes,
      contentType: reservation.contentType,
      createdAt: reservation.createdAt,
      expiresAt: reservation.expiresAt,
      cleanupAttempts: PHOTO_CLEANUP_MAX_ATTEMPTS,
      lastError: normalizeErrorMessage(error),
      deadLetteredAt: now,
    },
    { merge: true }
  );
  batch.delete(documentSnapshot.ref);
  await batch.commit();
}

async function reconcileExpiredPhotoUploadReservation(
  documentSnapshot: FirebaseFirestore.QueryDocumentSnapshot,
  reservation: PhotoUploadReservationDocument
): Promise<
  'referenced' | 'orphan_deleted' | 'missing_object' | 'retryable' | 'dead_letter'
> {
  const storagePath = extractOwnedPrivatePhotoPath(
    reservation.ownerUid,
    reservation.storagePath
  );

  if (!storagePath || storagePath !== reservation.storagePath) {
    await moveReservationCleanupToDeadLetter(
      documentSnapshot,
      reservation,
      new Error('Reserva expirada com storagePath inválido.')
    );
    return 'dead_letter';
  }

  try {
    if (await hasCanonicalPhotoReference(reservation)) {
      await documentSnapshot.ref.delete();
      return 'referenced';
    }

    const file = getDefaultStorageBucket().file(storagePath);
    const [exists] = await file.exists();

    if (!exists) {
      await documentSnapshot.ref.delete();
      return 'missing_object';
    }

    const [metadata] = await file.getMetadata();
    const storedReservationId = String(
      metadata.metadata?.['mediaPhotoReservationId'] ?? ''
    ).trim();

    if (storedReservationId !== documentSnapshot.id) {
      throw new Error(
        'Objeto sem vínculo verificável com a reserva de upload.'
      );
    }

    await file.delete({ ignoreNotFound: true });
    await documentSnapshot.ref.delete();
    return 'orphan_deleted';
  } catch (error) {
    const retry = nextPhotoCleanupRetry(
      reservation.cleanupAttempts ?? 0,
      Date.now()
    );

    if (retry.state === 'dead_letter') {
      await moveReservationCleanupToDeadLetter(
        documentSnapshot,
        reservation,
        error
      );
      return 'dead_letter';
    }

    await documentSnapshot.ref.set(
      {
        cleanupAttempts: retry.attempts,
        cleanupLastError: normalizeErrorMessage(error),
        cleanupUpdatedAt: Date.now(),
      },
      { merge: true }
    );

    logger.warn('[photoUploadReservation] Falha ao reconciliar upload expirado.', {
      reservationId: documentSnapshot.id,
      attempts: retry.attempts,
      error: normalizeErrorMessage(error),
    });
    return 'retryable';
  }
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

    const result = await db.runTransaction(async (transaction) => {
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

    logPhotoOperation({
      operation: 'photo.reserve_upload',
      outcome: 'success',
      startedAt: nowMs,
      counts: {
        sizeBytes,
      },
    });

    return result;
  }
);

export const cleanupExpiredPhotoUploadReservations = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 24 hours',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
    timeoutSeconds: 300,
  },
  async () => {
    const startedAt = Date.now();
    const snapshot = await db
      .collection(RESERVATION_COLLECTION)
      .where('expiresAt', '<=', Timestamp.now())
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    const counts = {
      scanned: snapshot.size,
      referenced: 0,
      orphanDeleted: 0,
      missingObject: 0,
      retryable: 0,
      deadLetter: 0,
    };

    for (
      let offset = 0;
      offset < snapshot.docs.length;
      offset += CLEANUP_CONCURRENCY
    ) {
      const chunk = snapshot.docs.slice(
        offset,
        offset + CLEANUP_CONCURRENCY
      );
      const outcomes = await Promise.all(
        chunk.map(async (documentSnapshot) => {
          const reservation =
            documentSnapshot.data() as PhotoUploadReservationDocument;
          return reconcileExpiredPhotoUploadReservation(
            documentSnapshot,
            reservation
          );
        })
      );

      for (const outcome of outcomes) {
        if (outcome === 'referenced') counts.referenced += 1;
        if (outcome === 'orphan_deleted') counts.orphanDeleted += 1;
        if (outcome === 'missing_object') counts.missingObject += 1;
        if (outcome === 'retryable') counts.retryable += 1;
        if (outcome === 'dead_letter') counts.deadLetter += 1;
      }
    }

    logPhotoOperation({
      operation: 'photo.cleanup_expired_uploads',
      outcome:
        counts.deadLetter > 0
          ? 'partial'
          : counts.retryable > 0
            ? 'retryable'
            : 'success',
      startedAt,
      counts,
    });
  }
);
