import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import { assertPrivateVideoUploadEligibility } from './private-video-upload-eligibility.service';
import {
  calculatePrivateVideoReservationBytes,
  estimateRegisteredVideoReservedBytes,
  evaluatePrivateVideoQuota,
  resolvePrivateVideoQuotaPlan,
  type PrivateVideoQuotaPlan,
} from './private-video-upload-quota.policy';
import {
  consumePrivateVideoUploadReservationAfterRegistration,
} from './private-video-upload-reservation-registration.service';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

export type PrivateVideoUploadReservationState =
  | 'ACTIVE'
  | 'CONSUMED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface PrivateVideoUploadReservationDocument {
  reservationId: string;
  clientRequestId: string;
  ownerUid: string;
  videoId: string;
  state: PrivateVideoUploadReservationState;
  videoStoragePath: string;
  posterStoragePath: string | null;
  videoSizeBytes: number;
  posterSizeBytes: number;
  mimeType: string;
  reservedBytes: number;
  plan: PrivateVideoQuotaPlan;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
  consumedAt: Timestamp | null;
  cleanupAfter: Timestamp | null;
}

interface ReservePrivateVideoUploadRequest {
  clientRequestId?: unknown;
  ownerUid?: unknown;
  videoId?: unknown;
  videoStoragePath?: unknown;
  posterStoragePath?: unknown;
  videoSizeBytes?: unknown;
  posterSizeBytes?: unknown;
  mimeType?: unknown;
}

interface ReservePrivateVideoUploadResponse {
  reservationId: string;
  ownerUid: string;
  videoId: string;
  plan: PrivateVideoQuotaPlan;
  expiresAt: number;
  reservedBytes: number;
  maxItems: number;
  maxReservedBytes: number;
  currentItems: number;
  currentReservedBytes: number;
}

interface CancelPrivateVideoUploadReservationRequest {
  reservationId?: unknown;
}

interface CancelPrivateVideoUploadReservationResponse {
  reservationId: string;
  released: boolean;
}

interface RegisteredPrivateVideoDocument {
  path?: unknown;
  url?: unknown;
  thumbnailPath?: unknown;
  thumbnailUrl?: unknown;
}

const RESERVATIONS_COLLECTION = 'media_private_video_upload_reservations';
const CAPACITY_LOCK_COLLECTION = 'media_private_video_upload_capacity';
const ACTIVE_RESERVATION_MS = 30 * 60 * 1000;
const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 50;
const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;
const MAX_POSTER_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
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

function normalizePositiveInteger(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed));
}

function normalizeMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
}

function reservationDocumentId(
  ownerUid: string,
  clientRequestId: string
): string {
  return createHash('sha256')
    .update(`${ownerUid}:${clientRequestId}`)
    .digest('hex');
}

function reservationReference(reservationId: string) {
  return db.collection(RESERVATIONS_COLLECTION).doc(reservationId);
}

function capacityLockReference(ownerUid: string) {
  return db.collection(CAPACITY_LOCK_COLLECTION).doc(ownerUid);
}

function nextLockGeneration(snapshot: FirebaseFirestore.DocumentSnapshot): number {
  const current = Number(snapshot.data()?.['generation'] ?? 0);
  return Number.isFinite(current) && current >= 0
    ? Math.trunc(current) + 1
    : 1;
}

function validateMaximumSizes(
  videoSizeBytes: number,
  posterSizeBytes: number
): void {
  if (!videoSizeBytes || videoSizeBytes > MAX_VIDEO_SIZE_BYTES) {
    throw new HttpsError(
      'invalid-argument',
      'O vídeo excede o limite permitido ou está vazio.'
    );
  }

  if (posterSizeBytes > MAX_POSTER_SIZE_BYTES) {
    throw new HttpsError(
      'invalid-argument',
      'A capa excede o limite permitido.'
    );
  }
}

function sameReservationRequest(
  reservation: PrivateVideoUploadReservationDocument,
  input: {
    clientRequestId: string;
    ownerUid: string;
    videoId: string;
    videoStoragePath: string;
    posterStoragePath: string | null;
    videoSizeBytes: number;
    posterSizeBytes: number;
    mimeType: string;
  }
): boolean {
  return reservation.clientRequestId === input.clientRequestId &&
    reservation.ownerUid === input.ownerUid &&
    reservation.videoId === input.videoId &&
    reservation.videoStoragePath === input.videoStoragePath &&
    reservation.posterStoragePath === input.posterStoragePath &&
    reservation.videoSizeBytes === input.videoSizeBytes &&
    reservation.posterSizeBytes === input.posterSizeBytes &&
    reservation.mimeType === input.mimeType;
}

function quotaHttpsError(
  reason: 'ITEM_LIMIT' | 'BYTE_LIMIT',
  details: Record<string, unknown>
): HttpsError {
  return new HttpsError(
    'resource-exhausted',
    reason === 'ITEM_LIMIT'
      ? 'Você atingiu o limite de vídeos do seu plano.'
      : 'Seus vídeos atingiram o limite de armazenamento do seu plano.',
    {
      code: reason === 'ITEM_LIMIT'
        ? 'VIDEO_UPLOAD_ITEM_LIMIT'
        : 'VIDEO_UPLOAD_BYTE_LIMIT',
      retryable: false,
      recovery: 'Exclua um vídeo existente ou altere o plano antes de continuar.',
      ...details,
    }
  );
}

function buildReserveResponse(
  reservation: PrivateVideoUploadReservationDocument,
  usage: {
    currentItems: number;
    currentReservedBytes: number;
  },
  limit: {
    maxItems: number;
    maxReservedBytes: number;
  }
): ReservePrivateVideoUploadResponse {
  return {
    reservationId: reservation.reservationId,
    ownerUid: reservation.ownerUid,
    videoId: reservation.videoId,
    plan: reservation.plan,
    expiresAt: reservation.expiresAt.toMillis(),
    reservedBytes: reservation.reservedBytes,
    maxItems: limit.maxItems,
    maxReservedBytes: limit.maxReservedBytes,
    currentItems: usage.currentItems,
    currentReservedBytes: usage.currentReservedBytes,
  };
}

async function isReservationRegistered(
  reservation: PrivateVideoUploadReservationDocument
): Promise<boolean> {
  const snapshot = await db
    .doc(`users/${reservation.ownerUid}/videos/${reservation.videoId}`)
    .get();

  if (!snapshot.exists) {
    return false;
  }

  const video = snapshot.data() as RegisteredPrivateVideoDocument;
  const registeredVideoPath = extractOwnedPrivateVideoPathForId(
    reservation.ownerUid,
    reservation.videoId,
    video.path ?? video.url
  );
  const rawPosterPath = String(
    video.thumbnailPath ?? video.thumbnailUrl ?? ''
  ).trim();
  const registeredPosterPath = rawPosterPath
    ? extractOwnedPrivateVideoPosterPath(
      reservation.ownerUid,
      reservation.videoId,
      rawPosterPath
    )
    : null;

  return registeredVideoPath === reservation.videoStoragePath &&
    registeredPosterPath === reservation.posterStoragePath;
}

async function deleteReservedObjectsBestEffort(
  reservation: PrivateVideoUploadReservationDocument
): Promise<void> {
  if (await isReservationRegistered(reservation)) {
    logger.info(
      '[privateVideoUploadReservation] Limpeza ignorada para vídeo registrado.',
      {
        reservationId: reservation.reservationId,
        ownerUid: reservation.ownerUid,
        videoId: reservation.videoId,
      }
    );
    return;
  }

  const videoPath = extractOwnedPrivateVideoPathForId(
    reservation.ownerUid,
    reservation.videoId,
    reservation.videoStoragePath
  );
  const posterPath = reservation.posterStoragePath
    ? extractOwnedPrivateVideoPosterPath(
      reservation.ownerUid,
      reservation.videoId,
      reservation.posterStoragePath
    )
    : null;
  const paths = [
    ...(videoPath ? [videoPath] : []),
    ...(posterPath ? [posterPath] : []),
  ];

  await Promise.all(paths.map(async (storagePath) => {
    try {
      await storage
        .bucket()
        .file(storagePath)
        .delete({ ignoreNotFound: true });
    } catch (error) {
      logger.warn('[privateVideoUploadReservation] Limpeza pendente.', {
        reservationId: reservation.reservationId,
        ownerUid: reservation.ownerUid,
        videoId: reservation.videoId,
        error: normalizeErrorMessage(error),
      });
    }
  }));
}

async function transitionActiveReservation(
  reservationId: string,
  expectedOwnerUid: string | null,
  terminalState: 'CANCELLED' | 'EXPIRED'
): Promise<PrivateVideoUploadReservationDocument | null> {
  const reservationRef = reservationReference(reservationId);
  const now = Date.now();
  const cleanupAfter = now + TERMINAL_RETENTION_MS;

  return db.runTransaction(async (transaction) => {
    const reservationSnapshot = await transaction.get(reservationRef);

    if (!reservationSnapshot.exists) {
      return null;
    }

    const reservation = reservationSnapshot.data() as
      PrivateVideoUploadReservationDocument;

    if (
      reservation.state !== 'ACTIVE' ||
      (expectedOwnerUid && reservation.ownerUid !== expectedOwnerUid)
    ) {
      return null;
    }

    const lockRef = capacityLockReference(reservation.ownerUid);
    const lockSnapshot = await transaction.get(lockRef);

    transaction.update(reservationRef, {
      state: terminalState,
      updatedAt: Timestamp.fromMillis(now),
      expiresAt: Timestamp.fromMillis(cleanupAfter),
      cleanupAfter: Timestamp.fromMillis(cleanupAfter),
    });
    transaction.set(
      lockRef,
      {
        generation: nextLockGeneration(lockSnapshot),
        updatedAt: now,
      },
      { merge: true }
    );

    return reservation;
  });
}

export async function cancelPrivateVideoUploadReservationById(
  reservationIdValue: unknown,
  expectedOwnerUid: string | null = null
): Promise<boolean> {
  const reservationId = cleanId(reservationIdValue);

  if (!reservationId) {
    return false;
  }

  const reservation = await transitionActiveReservation(
    reservationId,
    expectedOwnerUid,
    'CANCELLED'
  );

  if (!reservation) {
    return false;
  }

  await deleteReservedObjectsBestEffort(reservation);
  return true;
}

export const reservePrivateVideoUpload = onCall<ReservePrivateVideoUploadRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ReservePrivateVideoUploadResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const videoId = cleanId(request.data?.videoId);
    const clientRequestId = cleanId(request.data?.clientRequestId);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (
      !ownerUid ||
      requesterUid !== ownerUid ||
      !videoId ||
      !clientRequestId
    ) {
      throw new HttpsError(
        'invalid-argument',
        'Os dados da reserva de upload são inválidos.'
      );
    }

    const videoStoragePath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      request.data?.videoStoragePath
    );
    const rawPosterPath = String(request.data?.posterStoragePath ?? '').trim();
    const posterStoragePath = rawPosterPath
      ? extractOwnedPrivateVideoPosterPath(
        ownerUid,
        videoId,
        rawPosterPath
      )
      : null;
    const videoSizeBytes = normalizePositiveInteger(
      request.data?.videoSizeBytes
    );
    const posterSizeBytes = normalizePositiveInteger(
      request.data?.posterSizeBytes
    );
    const mimeType = normalizeMimeType(request.data?.mimeType);

    if (
      !videoStoragePath ||
      (rawPosterPath && !posterStoragePath) ||
      (posterStoragePath === null) !== (posterSizeBytes === 0) ||
      !ALLOWED_VIDEO_TYPES.has(mimeType)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'O arquivo ou os caminhos da reserva são inválidos.'
      );
    }

    validateMaximumSizes(videoSizeBytes, posterSizeBytes);
    const user = await assertPrivateVideoUploadEligibility(ownerUid);
    const reservationId = reservationDocumentId(ownerUid, clientRequestId);
    const reservationRef = reservationReference(reservationId);
    const lockRef = capacityLockReference(ownerUid);
    const userRef = db.doc(`users/${ownerUid}`);
    const videosQuery = db.collection(`users/${ownerUid}/videos`);
    const reservationsQuery = db
      .collection(RESERVATIONS_COLLECTION)
      .where('ownerUid', '==', ownerUid);
    const now = Date.now();
    const reservedBytes = calculatePrivateVideoReservationBytes(
      videoSizeBytes,
      posterSizeBytes
    );
    const requestIdentity = {
      clientRequestId,
      ownerUid,
      videoId,
      videoStoragePath,
      posterStoragePath,
      videoSizeBytes,
      posterSizeBytes,
      mimeType,
    };

    return db.runTransaction(async (transaction) => {
      const [
        existingSnapshot,
        lockSnapshot,
        userSnapshot,
        videosSnapshot,
        reservationsSnapshot,
      ] = await Promise.all([
        transaction.get(reservationRef),
        transaction.get(lockRef),
        transaction.get(userRef),
        transaction.get(videosQuery),
        transaction.get(reservationsQuery),
      ]);
      const transactionalUser = userSnapshot.exists
        ? userSnapshot.data() as Record<string, unknown>
        : user;
      const plan = resolvePrivateVideoQuotaPlan(transactionalUser, now);
      const registeredVideoIds = new Set(
        videosSnapshot.docs.map((document) => document.id)
      );
      const registeredReservedBytes = videosSnapshot.docs.reduce(
        (total, document) =>
          total + estimateRegisteredVideoReservedBytes(document.data()),
        0
      );
      const activeReservations = reservationsSnapshot.docs
        .map((document) =>
          document.data() as PrivateVideoUploadReservationDocument
        )
        .filter((reservation) =>
          reservation.state === 'ACTIVE' &&
          reservation.expiresAt.toMillis() > now &&
          !registeredVideoIds.has(reservation.videoId)
        );
      const usage = {
        currentItems: videosSnapshot.size + activeReservations.length,
        currentReservedBytes:
          registeredReservedBytes +
          activeReservations.reduce(
            (total, reservation) => total + reservation.reservedBytes,
            0
          ),
      };

      if (existingSnapshot.exists) {
        const existing = existingSnapshot.data() as
          PrivateVideoUploadReservationDocument;

        if (
          existing.state === 'ACTIVE' &&
          existing.expiresAt.toMillis() > now &&
          sameReservationRequest(existing, requestIdentity)
        ) {
          const limit = evaluatePrivateVideoQuota(
            existing.plan,
            { currentItems: 0, currentReservedBytes: 0 },
            0
          ).limit;
          return buildReserveResponse(existing, usage, limit);
        }

        throw new HttpsError(
          'already-exists',
          'O identificador desta tentativa de upload já foi utilizado.'
        );
      }

      const decision = evaluatePrivateVideoQuota(
        plan,
        usage,
        reservedBytes
      );

      if (!decision.allowed) {
        throw quotaHttpsError(decision.reason, {
          plan,
          currentItems: decision.usage.currentItems,
          currentReservedBytes: decision.usage.currentReservedBytes,
          maxItems: decision.limit.maxItems,
          maxReservedBytes: decision.limit.maxReservedBytes,
        });
      }

      const createdAt = Timestamp.fromMillis(now);
      const reservation: PrivateVideoUploadReservationDocument = {
        reservationId,
        clientRequestId,
        ownerUid,
        videoId,
        state: 'ACTIVE',
        videoStoragePath,
        posterStoragePath,
        videoSizeBytes,
        posterSizeBytes,
        mimeType,
        reservedBytes,
        plan,
        createdAt,
        updatedAt: createdAt,
        expiresAt: Timestamp.fromMillis(now + ACTIVE_RESERVATION_MS),
        consumedAt: null,
        cleanupAfter: null,
      };

      transaction.create(reservationRef, reservation);
      transaction.set(
        lockRef,
        {
          generation: nextLockGeneration(lockSnapshot),
          updatedAt: now,
          lastReservationId: reservationId,
        },
        { merge: true }
      );

      return buildReserveResponse(
        reservation,
        decision.usage,
        decision.limit
      );
    });
  }
);

export const cancelPrivateVideoUploadReservation = onCall<
  CancelPrivateVideoUploadReservationRequest
>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<CancelPrivateVideoUploadReservationResponse> => {
    const requesterUid = cleanId(request.auth?.uid);
    const reservationId = cleanId(request.data?.reservationId);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    if (!reservationId) {
      throw new HttpsError('invalid-argument', 'Reserva inválida.');
    }

    const snapshot = await reservationReference(reservationId).get();

    if (!snapshot.exists) {
      return { reservationId, released: false };
    }

    const reservation = snapshot.data() as
      PrivateVideoUploadReservationDocument;

    if (reservation.ownerUid !== requesterUid) {
      throw new HttpsError(
        'permission-denied',
        'A reserva não pertence ao usuário autenticado.'
      );
    }

    const released = await cancelPrivateVideoUploadReservationById(
      reservationId,
      requesterUid
    );

    return { reservationId, released };
  }
);

export const cleanupPrivateVideoUploadReservations = onSchedule(
  {
    region: FUNCTIONS_REGION,
    schedule: 'every 30 minutes',
    timeZone: 'America/Sao_Paulo',
    retryCount: 3,
  },
  async () => {
    const now = Timestamp.now();
    const terminalSnapshot = await db
      .collection(RESERVATIONS_COLLECTION)
      .where('cleanupAfter', '<=', now)
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    if (!terminalSnapshot.empty) {
      const batch = db.batch();
      terminalSnapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }

    const expiredSnapshot = await db
      .collection(RESERVATIONS_COLLECTION)
      .where('expiresAt', '<=', now)
      .limit(CLEANUP_BATCH_SIZE)
      .get();

    for (const document of expiredSnapshot.docs) {
      const reservation = document.data() as
        PrivateVideoUploadReservationDocument;

      if (reservation.state !== 'ACTIVE') {
        continue;
      }

      try {
        if (await isReservationRegistered(reservation)) {
          await consumePrivateVideoUploadReservationAfterRegistration({
            reservationId: reservation.reservationId,
            ownerUid: reservation.ownerUid,
            videoId: reservation.videoId,
            videoStoragePath: reservation.videoStoragePath,
            posterStoragePath: reservation.posterStoragePath,
            videoSizeBytes: reservation.videoSizeBytes,
            mimeType: reservation.mimeType,
          });
          continue;
        }

        const expired = await transitionActiveReservation(
          document.id,
          reservation.ownerUid,
          'EXPIRED'
        );

        if (expired) {
          await deleteReservedObjectsBestEffort(expired);
        }
      } catch (error) {
        logger.error('[privateVideoUploadReservation] Falha ao expirar.', {
          reservationId: document.id,
          ownerUid: reservation.ownerUid,
          videoId: reservation.videoId,
          error: normalizeErrorMessage(error),
        });
      }
    }
  }
);
