import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import {
  assertMediaAuthoringEligibility,
} from './media-authoring-eligibility.service';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db, getDefaultStorageBucket } from '../../firebaseApp';
import {
  assertCallableAppCheck,
  REQUIRE_CALLABLE_APP_CHECK,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import {
  IMAGE_INPUT_MIME_TYPES,
  IMAGE_MAX_BYTES,
} from '../media-format.generated';
import { extractOwnedPrivatePhotoPath } from './photo-storage-path';

type PrivatePhotoCommitMode = 'create' | 'replace';

interface RegisterPrivatePhotoUploadRequest {
  ownerUid?: unknown;
  photoId?: unknown;
  storagePath?: unknown;
  url?: unknown;
  fileName?: unknown;
  mode?: unknown;
}

interface RegisterPrivatePhotoUploadResponse {
  ownerUid: string;
  photoId: string;
  storagePath: string;
  mode: PrivatePhotoCommitMode;
  createdAt: number;
}

interface PhotoUploadReservationDocument {
  ownerUid?: unknown;
  storagePath?: unknown;
  sizeBytes?: unknown;
  contentType?: unknown;
  expiresAt?: unknown;
}

const RESERVATION_COLLECTION = 'media_photo_upload_reservations';
const ALLOWED_CONTENT_TYPES = new Set<string>(IMAGE_INPUT_MIME_TYPES);
const REGISTER_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 20,
  sustainedWindowMs: 10 * 60_000,
  sustainedMax: 80,
});

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

function cleanFileName(value: unknown): string {
  const raw = String(value ?? '');
  let normalized = '';

  for (const character of raw) {
    const code = character.codePointAt(0);
    if (code !== undefined && code > 31 && code !== 127) {
      normalized += character;
    }
  }

  return normalized.trim().slice(0, 180) || 'foto';
}

function cleanMode(value: unknown): PrivatePhotoCommitMode | null {
  return value === 'create' || value === 'replace' ? value : null;
}

function normalizePositiveInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function normalizeContentType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function toMillis(value: unknown): number {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  const candidate = value as { toMillis?: () => number } | null | undefined;
  if (typeof candidate?.toMillis === 'function') {
    return Number(candidate.toMillis());
  }

  return 0;
}

function buildReservationId(ownerUid: string, storagePath: string): string {
  return createHash('sha256')
    .update(`${ownerUid}:${storagePath}`)
    .digest('hex');
}

function assertOwner(requesterUid: string, ownerUid: string): void {
  if (!requesterUid) {
    throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  }

  if (requesterUid !== ownerUid) {
    throw new HttpsError(
      'permission-denied',
      'A foto só pode ser registrada no perfil autenticado.'
    );
  }
}

export const registerPrivatePhotoUpload = onCall<
  RegisterPrivatePhotoUploadRequest
>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
  },
  async (request): Promise<RegisterPrivatePhotoUploadResponse> => {
    assertCallableAppCheck(request.app);

    const requesterUid = cleanId(request.auth?.uid);
    const ownerUid = cleanId(request.data?.ownerUid);
    const photoId = cleanId(request.data?.photoId);
    const mode = cleanMode(request.data?.mode);

    if (!ownerUid || !photoId || !mode) {
      throw new HttpsError(
        'invalid-argument',
        'Foto, proprietário ou operação inválidos.'
      );
    }

    assertOwner(requesterUid, ownerUid);

    await consumeBackendRateLimitQuota({
      action: 'photo-private-upload-register',
      subject: requesterUid,
      config: REGISTER_RATE_LIMIT,
      message: 'Muitas tentativas de registro de foto foram feitas em pouco tempo.',
    });
    await assertMediaAuthoringEligibility(ownerUid);

    const storagePath = extractOwnedPrivatePhotoPath(
      ownerUid,
      request.data?.storagePath
    );
    const urlPath = extractOwnedPrivatePhotoPath(ownerUid, request.data?.url);
    const fileName = cleanFileName(request.data?.fileName);

    if (!storagePath || urlPath !== storagePath) {
      throw new HttpsError(
        'invalid-argument',
        'O caminho da foto não corresponde ao arquivo privado informado.'
      );
    }

    const reservationId = buildReservationId(ownerUid, storagePath);
    const reservationRef = db
      .collection(RESERVATION_COLLECTION)
      .doc(reservationId);
    const reservationSnap = await reservationRef.get();

    if (!reservationSnap.exists) {
      throw new HttpsError(
        'failed-precondition',
        'A reserva do upload não foi encontrada ou já expirou.'
      );
    }

    const reservation = reservationSnap.data() as PhotoUploadReservationDocument;
    const reservationOwnerUid = cleanId(reservation.ownerUid);
    const reservationStoragePath = extractOwnedPrivatePhotoPath(
      ownerUid,
      reservation.storagePath
    );
    const reservationSizeBytes = normalizePositiveInteger(
      reservation.sizeBytes
    );
    const reservationContentType = normalizeContentType(
      reservation.contentType
    );
    const reservationExpiresAt = toMillis(reservation.expiresAt);

    if (
      reservationOwnerUid !== ownerUid ||
      reservationStoragePath !== storagePath ||
      !reservationSizeBytes ||
      reservationExpiresAt <= Date.now() ||
      !ALLOWED_CONTENT_TYPES.has(reservationContentType)
    ) {
      throw new HttpsError(
        'failed-precondition',
        'A reserva do upload não corresponde à foto enviada.'
      );
    }

    const file = getDefaultStorageBucket().file(storagePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new HttpsError(
        'failed-precondition',
        'O arquivo enviado não foi encontrado no armazenamento.'
      );
    }

    const [metadata] = await file.getMetadata();
    const storedReservationId = String(
      metadata.metadata?.['mediaPhotoReservationId'] ?? ''
    ).trim();
    const storedContentType = normalizeContentType(metadata.contentType);
    const storedSizeBytes = normalizePositiveInteger(metadata.size);

    if (storedReservationId !== reservationId) {
      throw new HttpsError(
        'failed-precondition',
        'O arquivo armazenado não corresponde à reserva deste upload.'
      );
    }

    if (
      storedContentType !== reservationContentType ||
      storedSizeBytes !== reservationSizeBytes ||
      storedSizeBytes > IMAGE_MAX_BYTES
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Os metadados do arquivo armazenado divergem da reserva.'
      );
    }

    const photoRef = db.doc(`users/${ownerUid}/photos/${photoId}`);
    const now = Date.now();

    await db.runTransaction(async (transaction) => {
      const [photoSnap, freshReservationSnap] = await Promise.all([
        transaction.get(photoRef),
        transaction.get(reservationRef),
      ]);

      if (!freshReservationSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          'A reserva do upload já foi consumida.'
        );
      }

      if (mode === 'create' && photoSnap.exists) {
        throw new HttpsError(
          'already-exists',
          'A foto privada já está registrada.'
        );
      }

      if (mode === 'replace' && !photoSnap.exists) {
        throw new HttpsError(
          'not-found',
          'A foto privada a ser substituída não foi encontrada.'
        );
      }

      const criticalPayload = {
        id: photoId,
        url: String(request.data?.url ?? '').trim(),
        path: storagePath,
        fileName,
        updatedAt: Timestamp.fromMillis(now),
      };

      if (mode === 'create') {
        transaction.create(photoRef, {
          ...criticalPayload,
          createdAt: Timestamp.fromMillis(now),
        });
      } else {
        transaction.update(photoRef, criticalPayload);
      }

      transaction.delete(reservationRef);
    });

    logger.info('[registerPrivatePhotoUpload] Foto privada registrada.', {
      ownerUid,
      photoId,
      mode,
      storagePath,
    });

    return {
      ownerUid,
      photoId,
      storagePath,
      mode,
      createdAt: now,
    };
  }
);
