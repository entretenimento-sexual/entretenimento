import { createHash, randomUUID } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import {
  VIDEO_INPUT_MIME_TYPES,
  VIDEO_MAX_BYTES,
  VIDEO_POSTER_IMAGE_MAX_BYTES,
} from '../media-format.generated';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import { assertPrivateVideoUploadEligibility } from './private-video-upload-eligibility.service';
import {
  VIDEO_UPLOAD_RESERVATION_TTL_MS,
  evaluateVideoUploadQuota,
} from './video-upload-reservation.policy';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

interface ReserveVideoUploadRequest {
  ownerUid?: unknown;
  videoId?: unknown;
  videoStoragePath?: unknown;
  videoSizeBytes?: unknown;
  videoContentType?: unknown;
  posterStoragePath?: unknown;
  posterSizeBytes?: unknown;
  posterContentType?: unknown;
}

interface ReserveVideoUploadResponse {
  reservationId: string;
  expiresAt: number;
}

export interface VideoUploadReservationDocument {
  reservationId: string;
  ownerUid: string;
  videoId: string;
  videoStoragePath: string;
  videoSizeBytes: number;
  videoContentType: string;
  posterStoragePath: string | null;
  posterSizeBytes: number;
  posterContentType: string | null;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  phase?: 'READY' | 'REGISTERING' | 'CLEANING';
  phaseStartedAt?: number;
  phaseOwner?: string;
  cleanupAttempts?: number;
  cleanupLastError?: string | null;
}

const RESERVATION_COLLECTION = 'media_video_upload_reservations';
const QUOTA_COLLECTION = 'media_video_upload_quota';
const DEAD_LETTER_COLLECTION = 'media_video_upload_cleanup_dead_letters';
const CLEANUP_BATCH_SIZE = 50;
const CLEANUP_MAX_ATTEMPTS = 5;
const PHASE_LEASE_MS = 15 * 60_000;
const DEAD_LETTER_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const ALLOWED_VIDEO_TYPES = new Set<string>(VIDEO_INPUT_MIME_TYPES);
const VIDEO_UPLOAD_RESERVE_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 8,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 30,
});

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{1,128}$/.test(normalized) ? normalized : '';
}

function normalizePositiveInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizeMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function buildReservationId(ownerUid: string, videoId: string): string {
  return createHash('sha256')
    .update(`video-upload:${ownerUid}:${videoId}`)
    .digest('hex');
}

function reservationExpiryMs(value: unknown): number {
  if (
    value &&
    typeof value === 'object' &&
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

function sameReservation(
  current: VideoUploadReservationDocument,
  input: Omit<
    VideoUploadReservationDocument,
    'reservationId' | 'createdAt' | 'expiresAt' |
    'cleanupAttempts' | 'cleanupLastError' | 'phase' | 'phaseStartedAt' | 'phaseOwner'
  >
): boolean {
  return current.ownerUid === input.ownerUid
    && current.videoId === input.videoId
    && current.videoStoragePath === input.videoStoragePath
    && current.videoSizeBytes === input.videoSizeBytes
    && current.videoContentType === input.videoContentType
    && current.posterStoragePath === input.posterStoragePath
    && current.posterSizeBytes === input.posterSizeBytes
    && current.posterContentType === input.posterContentType;
}

async function hasCanonicalVideoReference(
  reservation: VideoUploadReservationDocument
): Promise<boolean> {
  const snapshot = await db
    .doc(`users/${reservation.ownerUid}/videos/${reservation.videoId}`)
    .get();

  if (!snapshot.exists) return false;

  const data = snapshot.data() as {
    path?: unknown;
    thumbnailPath?: unknown;
  };

  const videoPath = extractOwnedPrivateVideoPathForId(
    reservation.ownerUid,
    reservation.videoId,
    data.path
  );
  const posterPath = data.thumbnailPath
    ? extractOwnedPrivateVideoPosterPath(
      reservation.ownerUid,
      reservation.videoId,
      data.thumbnailPath
    )
    : null;

  return videoPath === reservation.videoStoragePath
    && posterPath === reservation.posterStoragePath;
}

async function deleteReservedObjectIfOwned(
  reservationId: string,
  storagePath: string | null
): Promise<void> {
  if (!storagePath) return;

  const file = storage.bucket().file(storagePath);
  const [exists] = await file.exists();

  if (!exists) return;

  const [metadata] = await file.getMetadata();
  const storedReservationId = String(
    metadata.metadata?.['mediaVideoReservationId'] ?? ''
  ).trim();

  if (storedReservationId !== reservationId) {
    throw new Error('Objeto sem vínculo verificável com a reserva de vídeo.');
  }

  await file.delete({ ignoreNotFound: true });
}

async function deadLetterReservation(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
  reservation: VideoUploadReservationDocument,
  error: unknown
): Promise<void> {
  const now = Date.now();
  const batch = db.batch();

  batch.set(
    db.collection(DEAD_LETTER_COLLECTION).doc(snapshot.id),
    {
      ...reservation,
      cleanupAttempts: CLEANUP_MAX_ATTEMPTS,
      lastError: normalizeErrorMessage(error),
      deadLetteredAt: now,
      deadLetterExpiresAt: now + DEAD_LETTER_RETENTION_MS,
    },
    { merge: true }
  );
  batch.delete(snapshot.ref);
  await batch.commit();
}

export async function reconcileExpiredReservation(
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
  reservation: VideoUploadReservationDocument
): Promise<'referenced' | 'orphan_deleted' | 'retryable' | 'dead_letter'> {
  try {
    // Compare-and-claim impede a limpeza de ultrapassar um registro iniciado.
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(snapshot.ref);
      if (!fresh.exists) return false;
      const current = fresh.data() as VideoUploadReservationDocument;
      if ((current.phase && current.phase !== 'READY' && Date.now() - Number(current.phaseStartedAt ?? 0) < PHASE_LEASE_MS) ||
          reservationExpiryMs(current.expiresAt) > Date.now()) {
        return false;
      }
      tx.update(snapshot.ref, {
        phase: 'CLEANING',
        phaseStartedAt: Date.now(),
        phaseOwner: randomUUID(),
      });
      return true;
    });
    if (!claimed) return 'referenced';

    if (await hasCanonicalVideoReference(reservation)) {
      await snapshot.ref.delete();
      return 'referenced';
    }

    await Promise.all([
      deleteReservedObjectIfOwned(
        reservation.reservationId,
        reservation.videoStoragePath
      ),
      deleteReservedObjectIfOwned(
        reservation.reservationId,
        reservation.posterStoragePath
      ),
    ]);

    await snapshot.ref.delete();
    return 'orphan_deleted';
  } catch (error) {
    const attempts = Number(reservation.cleanupAttempts ?? 0) + 1;

    if (attempts >= CLEANUP_MAX_ATTEMPTS) {
      await deadLetterReservation(snapshot, reservation, error);
      return 'dead_letter';
    }

    await snapshot.ref.set(
      {
        cleanupAttempts: attempts,
        cleanupLastError: normalizeErrorMessage(error),
        cleanupUpdatedAt: Date.now(),
      },
      { merge: true }
    );

    logger.warn('[videoUploadReservation] Falha ao reconciliar reserva.', {
      reservationId: snapshot.id,
      attempts,
      error: normalizeErrorMessage(error),
    });
    return 'retryable';
  }
}

export const reserveVideoUpload = onCall<ReserveVideoUploadRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<ReserveVideoUploadResponse> => {
    assertCallableAppCheck(request.app);

    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!ownerUid || requesterUid !== ownerUid || !videoId) {
      throw new HttpsError(
        'permission-denied',
        'A reserva de vídeo só pode ser criada para o perfil autenticado.'
      );
    }

    const videoStoragePath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      request.data?.videoStoragePath
    );
    const videoSizeBytes = normalizePositiveInteger(
      request.data?.videoSizeBytes
    );
    const videoContentType = normalizeMimeType(
      request.data?.videoContentType
    );

    const rawPosterPath = String(request.data?.posterStoragePath ?? '').trim();
    const posterStoragePath = rawPosterPath
      ? extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        rawPosterPath
      )
      : null;
    const posterSizeBytes = posterStoragePath
      ? normalizePositiveInteger(request.data?.posterSizeBytes)
      : 0;
    const posterContentType = posterStoragePath
      ? normalizeMimeType(request.data?.posterContentType)
      : null;

    if (
      !videoStoragePath ||
      !ALLOWED_VIDEO_TYPES.has(videoContentType) ||
      !videoSizeBytes ||
      videoSizeBytes > VIDEO_MAX_BYTES
    ) {
      throw new HttpsError(
        'invalid-argument',
        'O vídeo não possui path, formato ou tamanho válidos para reserva.'
      );
    }

    if (
      rawPosterPath &&
      (
        !posterStoragePath ||
        posterContentType !== 'image/jpeg' ||
        !posterSizeBytes ||
        posterSizeBytes > VIDEO_POSTER_IMAGE_MAX_BYTES
      )
    ) {
      throw new HttpsError(
        'invalid-argument',
        'A capa do vídeo não possui path, formato ou tamanho válidos.'
      );
    }

    await assertPrivateVideoUploadEligibility(ownerUid);

    const nowMs = Date.now();
    await consumeBackendRateLimitQuota({
      action: 'video-upload-reservation',
      subject: ownerUid,
      config: VIDEO_UPLOAD_RESERVE_RATE_LIMIT,
      message: 'Muitas tentativas de upload de vídeo foram iniciadas em pouco tempo.',
      now: nowMs,
    });

    const reservationId = buildReservationId(ownerUid, videoId);
    const reservationRef = db
      .collection(RESERVATION_COLLECTION)
      .doc(reservationId);
    const quotaRef = db.collection(QUOTA_COLLECTION).doc(ownerUid);
    const requestedBytes = videoSizeBytes + posterSizeBytes;

    const result = await db.runTransaction(async (transaction) => {
      const currentSnapshot = await transaction.get(reservationRef);

      const reservationBase = {
        ownerUid,
        videoId,
        videoStoragePath,
        videoSizeBytes,
        videoContentType,
        posterStoragePath,
        posterSizeBytes,
        posterContentType,
      };

      if (currentSnapshot.exists) {
        const current =
          currentSnapshot.data() as VideoUploadReservationDocument;
        const expiresAtMs = reservationExpiryMs(current.expiresAt);

        if (
          expiresAtMs > nowMs &&
          sameReservation(current, reservationBase)
        ) {
          return { reservationId, expiresAt: expiresAtMs };
        }

        if (expiresAtMs > nowMs) {
          throw new HttpsError(
            'already-exists',
            'Já existe uma reserva ativa incompatível para este vídeo.'
          );
        }
      }

      const quotaSnapshot = await transaction.get(quotaRef);
      const quotaDecision = evaluateVideoUploadQuota(
        quotaSnapshot.exists ? quotaSnapshot.data() : null,
        requestedBytes,
        nowMs
      );

      if (!quotaDecision.allowed) {
        throw new HttpsError(
          'resource-exhausted',
          'O limite temporário de uploads de vídeo foi atingido. Tente novamente mais tarde.',
          {
            reason: quotaDecision.reason,
            retryAfterMs: quotaDecision.retryAfterMs,
          }
        );
      }

      const expiresAtMs = nowMs + VIDEO_UPLOAD_RESERVATION_TTL_MS;
      const reservation: VideoUploadReservationDocument = {
        reservationId,
        ...reservationBase,
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

    return result;
  }
);

export const cleanupExpiredVideoUploadReservations = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 60 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
    timeoutSeconds: 300,
  },
  async () => {
    const snapshot = await db
      .collection(RESERVATION_COLLECTION)
      .where('expiresAt', '<=', Timestamp.now())
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    for (const documentSnapshot of snapshot.docs) {
      await reconcileExpiredReservation(
        documentSnapshot,
        documentSnapshot.data() as VideoUploadReservationDocument
      );
    }

    const expiredDeadLetters = await db
      .collection(DEAD_LETTER_COLLECTION)
      .where(
        'deadLetteredAt',
        '<=',
        Date.now() - DEAD_LETTER_RETENTION_MS
      )
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    if (!expiredDeadLetters.empty) {
      const batch = db.batch();
      expiredDeadLetters.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
  }
);

export async function assertVideoUploadReservation(input: {
  reservationId: string;
  ownerUid: string;
  videoId: string;
  videoStoragePath: string;
  videoSizeBytes: number;
  videoContentType: string;
  posterStoragePath: string | null;
  posterSizeBytes: number;
  posterContentType: string | null;
}): Promise<void> {
  const snapshot = await db
    .collection(RESERVATION_COLLECTION)
    .doc(input.reservationId)
    .get();

  if (!snapshot.exists) {
    throw new HttpsError(
      'failed-precondition',
      'A reserva deste upload expirou. Inicie o envio novamente.'
    );
  }

  const reservation = snapshot.data() as VideoUploadReservationDocument;

  if (
    reservationExpiryMs(reservation.expiresAt) <= Date.now() ||
    reservation.ownerUid !== input.ownerUid ||
    reservation.videoId !== input.videoId ||
    reservation.videoStoragePath !== input.videoStoragePath ||
    reservation.videoSizeBytes !== input.videoSizeBytes ||
    reservation.videoContentType !== input.videoContentType ||
    reservation.posterStoragePath !== input.posterStoragePath ||
    reservation.posterSizeBytes !== input.posterSizeBytes ||
    reservation.posterContentType !== input.posterContentType
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A reserva não corresponde ao vídeo armazenado.'
    );
  }
}

export async function claimVideoUploadReservation(input: {
  reservationId: string;
  ownerUid: string;
  videoId: string;
}): Promise<string> {
  const ref = db.collection(RESERVATION_COLLECTION).doc(input.reservationId);
  const token = randomUUID();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError('failed-precondition', 'Reserva de vídeo inexistente.');
    }
    const data = snap.data() as VideoUploadReservationDocument;
    if (data.ownerUid !== input.ownerUid || data.videoId !== input.videoId ||
        (data.phase && data.phase !== 'READY' && Date.now() - Number(data.phaseStartedAt ?? 0) < PHASE_LEASE_MS) ||
        reservationExpiryMs(data.expiresAt) <= Date.now()) {
      throw new HttpsError('failed-precondition', 'A reserva não está disponível para registro.');
    }
    tx.update(ref, { phase: 'REGISTERING', phaseStartedAt: Date.now(), phaseOwner: token });
  });
  return token;
}

export async function releaseVideoUploadReservationClaim(reservationId: string, token: string): Promise<void> {
  const ref = db.collection(RESERVATION_COLLECTION).doc(reservationId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.['phaseOwner'] !== token || snap.data()?.['phase'] !== 'REGISTERING') return;
    tx.update(ref, { phase: 'READY', phaseStartedAt: 0, phaseOwner: '' });
  });
}

export async function consumeVideoUploadReservationBestEffort(
  reservationId: string
): Promise<void> {
  try {
    await db.collection(RESERVATION_COLLECTION).doc(reservationId).delete();
  } catch (error) {
    logger.warn('[videoUploadReservation] Reserva registrada aguarda limpeza.', {
      reservationId,
      error: normalizeErrorMessage(error),
    });
  }
}
