import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import type { PrivateVideoUploadReservationDocument } from './private-video-upload-reservation.handler';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

export interface PrivateVideoReservationRegistrationInput {
  reservationId: string;
  ownerUid: string;
  videoId: string;
  videoStoragePath: string;
  posterStoragePath: string | null;
  videoSizeBytes: number;
  mimeType: string;
}

const RESERVATIONS_COLLECTION = 'media_private_video_upload_reservations';
const CAPACITY_LOCK_COLLECTION = 'media_private_video_upload_capacity';
const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1000;

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

function normalizeInput(
  input: PrivateVideoReservationRegistrationInput
): PrivateVideoReservationRegistrationInput {
  const ownerUid = cleanId(input.ownerUid);
  const videoId = cleanId(input.videoId);
  const reservationId = cleanId(input.reservationId);
  const videoStoragePath = extractOwnedPrivateVideoPathForId(
    ownerUid,
    videoId,
    input.videoStoragePath
  );
  const rawPosterPath = String(input.posterStoragePath ?? '').trim();
  const posterStoragePath = rawPosterPath
    ? extractOwnedPrivateVideoPosterPath(ownerUid, videoId, rawPosterPath)
    : null;
  const videoSizeBytes = normalizePositiveInteger(input.videoSizeBytes);
  const mimeType = normalizeMimeType(input.mimeType);

  if (
    !ownerUid ||
    !videoId ||
    !reservationId ||
    !videoStoragePath ||
    (rawPosterPath && !posterStoragePath) ||
    !videoSizeBytes ||
    !mimeType
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A reserva de upload não corresponde ao vídeo registrado.',
      {
        code: 'VIDEO_UPLOAD_RESERVATION_MISMATCH',
        retryable: false,
        recovery: 'Selecione novamente o arquivo e reinicie o envio.',
      }
    );
  }

  return {
    reservationId,
    ownerUid,
    videoId,
    videoStoragePath,
    posterStoragePath,
    videoSizeBytes,
    mimeType,
  };
}

function assertReservationMatches(
  reservation: PrivateVideoUploadReservationDocument,
  input: PrivateVideoReservationRegistrationInput
): void {
  if (
    reservation.ownerUid !== input.ownerUid ||
    reservation.videoId !== input.videoId ||
    reservation.videoStoragePath !== input.videoStoragePath ||
    reservation.posterStoragePath !== input.posterStoragePath ||
    reservation.videoSizeBytes !== input.videoSizeBytes ||
    reservation.mimeType !== input.mimeType
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A reserva não corresponde ao arquivo enviado.',
      {
        code: 'VIDEO_UPLOAD_RESERVATION_MISMATCH',
        retryable: false,
        recovery: 'Selecione novamente o arquivo e reinicie o envio.',
      }
    );
  }
}

export async function assertPrivateVideoUploadReservation(
  inputValue: PrivateVideoReservationRegistrationInput
): Promise<PrivateVideoUploadReservationDocument> {
  const input = normalizeInput(inputValue);
  const snapshot = await reservationReference(input.reservationId).get();

  if (!snapshot.exists) {
    throw new HttpsError(
      'failed-precondition',
      'A reserva do upload não existe ou expirou.',
      {
        code: 'VIDEO_UPLOAD_RESERVATION_EXPIRED',
        retryable: true,
        recovery: 'Inicie o envio novamente para gerar uma nova reserva.',
      }
    );
  }

  const reservation = snapshot.data() as PrivateVideoUploadReservationDocument;
  assertReservationMatches(reservation, input);

  if (
    reservation.state !== 'CONSUMED' &&
    (
      reservation.state !== 'ACTIVE' ||
      reservation.expiresAt.toMillis() <= Date.now()
    )
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A reserva do upload expirou ou já foi cancelada.',
      {
        code: 'VIDEO_UPLOAD_RESERVATION_EXPIRED',
        retryable: true,
        recovery: 'Inicie o envio novamente para gerar uma nova reserva.',
      }
    );
  }

  return reservation;
}

export async function consumePrivateVideoUploadReservationAfterRegistration(
  inputValue: PrivateVideoReservationRegistrationInput
): Promise<PrivateVideoUploadReservationDocument> {
  const input = normalizeInput(inputValue);
  const reservationRef = reservationReference(input.reservationId);
  const lockRef = capacityLockReference(input.ownerUid);
  const videoRef = db.doc(`users/${input.ownerUid}/videos/${input.videoId}`);
  const now = Date.now();
  const cleanupAfter = now + TERMINAL_RETENTION_MS;

  return db.runTransaction(async (transaction) => {
    const [reservationSnapshot, lockSnapshot, videoSnapshot] =
      await Promise.all([
        transaction.get(reservationRef),
        transaction.get(lockRef),
        transaction.get(videoRef),
      ]);

    if (!reservationSnapshot.exists || !videoSnapshot.exists) {
      throw new HttpsError(
        'failed-precondition',
        'O vídeo ou sua reserva não estão disponíveis para confirmação.'
      );
    }

    const reservation = reservationSnapshot.data() as
      PrivateVideoUploadReservationDocument;
    assertReservationMatches(reservation, input);

    if (
      reservation.state !== 'ACTIVE' &&
      reservation.state !== 'CONSUMED'
    ) {
      throw new HttpsError(
        'failed-precondition',
        'A reserva do upload foi cancelada antes da confirmação.'
      );
    }

    transaction.set(
      videoRef,
      {
        videoReservationId: reservation.reservationId,
        quotaPlanAtUpload: reservation.plan,
        quotaReservedBytes: reservation.reservedBytes,
        posterSizeBytes: reservation.posterSizeBytes,
        updatedAt: now,
      },
      { merge: true }
    );

    if (reservation.state === 'ACTIVE') {
      transaction.update(reservationRef, {
        state: 'CONSUMED',
        consumedAt: Timestamp.fromMillis(now),
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
    }

    return reservation;
  });
}

async function findReservationForRegisteredVideo(
  ownerUid: string,
  videoId: string
): Promise<PrivateVideoUploadReservationDocument | null> {
  const snapshot = await db
    .collection(RESERVATIONS_COLLECTION)
    .where('ownerUid', '==', ownerUid)
    .get();
  const candidates = snapshot.docs
    .map((document) =>
      document.data() as PrivateVideoUploadReservationDocument
    )
    .filter((reservation) =>
      reservation.videoId === videoId &&
      (
        reservation.state === 'ACTIVE' ||
        reservation.state === 'CONSUMED'
      )
    )
    .sort((left, right) =>
      right.createdAt.toMillis() - left.createdAt.toMillis()
    );

  return candidates[0] ?? null;
}

export const consumeVideoUploadReservationOnRegistration = onDocumentCreated(
  {
    document: 'users/{ownerUid}/videos/{videoId}',
    region: FUNCTIONS_REGION,
    retry: true,
  },
  async (event) => {
    const ownerUid = cleanId(event.params.ownerUid);
    const videoId = cleanId(event.params.videoId);
    const video = event.data?.data() as Record<string, unknown> | undefined;

    if (!ownerUid || !videoId || !video) {
      return;
    }

    const reservation = await findReservationForRegisteredVideo(
      ownerUid,
      videoId
    );

    if (!reservation) {
      logger.error('[videoUploadReservation] Registro sem reserva.', {
        ownerUid,
        videoId,
      });
      return;
    }

    const videoStoragePath = extractOwnedPrivateVideoPathForId(
      ownerUid,
      videoId,
      video['path'] ?? video['url']
    );
    const rawPosterPath = String(
      video['thumbnailPath'] ?? video['thumbnailUrl'] ?? ''
    ).trim();
    const posterStoragePath = rawPosterPath
      ? extractOwnedPrivateVideoPosterPath(ownerUid, videoId, rawPosterPath)
      : null;
    const videoSizeBytes = normalizePositiveInteger(
      video['sourceSizeBytes'] ?? video['sizeBytes']
    );
    const mimeType = normalizeMimeType(
      video['sourceMimeType'] ?? video['mimeType']
    );

    if (!videoStoragePath || (rawPosterPath && !posterStoragePath)) {
      throw new Error('O vídeo registrado possui paths incompatíveis.');
    }

    await consumePrivateVideoUploadReservationAfterRegistration({
      reservationId: reservation.reservationId,
      ownerUid,
      videoId,
      videoStoragePath,
      posterStoragePath,
      videoSizeBytes,
      mimeType,
    });
  }
);
