import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, storage } from '../../firebaseApp';
import type { PrivateVideoQuotaPlan } from './private-video-upload-quota.policy';
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
  sourceDurationMs?: number;
  mimeType: string;
  reservedBytes: number;
  plan: PrivateVideoQuotaPlan;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  expiresAt: Timestamp;
  consumedAt: Timestamp | null;
  cleanupAfter: Timestamp | null;
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
const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 50;

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

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message.slice(0, 500);
  }

  return String(error ?? 'unknown').slice(0, 500);
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
