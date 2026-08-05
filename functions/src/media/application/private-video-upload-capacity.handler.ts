import { createHash } from 'node:crypto';

import { Timestamp } from 'firebase-admin/firestore';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { assertPrivateVideoUploadEligibility } from './private-video-upload-eligibility.service';
import {
  calculatePrivateVideoReservationBytes,
  estimateRegisteredVideoReservedBytes,
  evaluatePrivateVideoQuota,
  getPrivateVideoProductLimit,
  getPrivateVideoQuotaLimit,
  resolvePrivateVideoQuotaPlan,
  type PrivateVideoQuotaPlan,
} from './private-video-upload-quota.policy';
import {
  extractOwnedPrivateVideoPathForId,
  extractOwnedPrivateVideoPosterPath,
} from './video-storage-path';

interface PrivateVideoCapacityReservation {
  readonly ownerUid?: unknown;
  readonly videoId?: unknown;
  readonly state?: unknown;
  readonly reservedBytes?: unknown;
  readonly expiresAt?: unknown;
}

interface ReservePrivateVideoUploadRequest {
  readonly clientRequestId?: unknown;
  readonly ownerUid?: unknown;
  readonly videoId?: unknown;
  readonly videoStoragePath?: unknown;
  readonly posterStoragePath?: unknown;
  readonly videoSizeBytes?: unknown;
  readonly posterSizeBytes?: unknown;
  readonly sourceDurationMs?: unknown;
  readonly mimeType?: unknown;
}

interface PrivateVideoUploadReservationDocument {
  readonly reservationId: string;
  readonly clientRequestId: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly state: 'ACTIVE' | 'CONSUMED' | 'CANCELLED' | 'EXPIRED';
  readonly videoStoragePath: string;
  readonly posterStoragePath: string | null;
  readonly videoSizeBytes: number;
  readonly posterSizeBytes: number;
  readonly sourceDurationMs: number;
  readonly mimeType: string;
  readonly reservedBytes: number;
  readonly plan: PrivateVideoQuotaPlan;
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly consumedAt: Timestamp | null;
  readonly cleanupAfter: Timestamp | null;
}

interface ReservePrivateVideoUploadResponse {
  readonly reservationId: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly plan: PrivateVideoQuotaPlan;
  readonly expiresAt: number;
  readonly reservedBytes: number;
  readonly maxItems: number;
  readonly maxReservedBytes: number;
  readonly currentItems: number;
  readonly currentReservedBytes: number;
}

export interface PrivateVideoUploadCapacityResponse {
  readonly plan: PrivateVideoQuotaPlan;
  readonly currentItems: number;
  readonly maxItems: number;
  readonly remainingItems: number;
  readonly currentReservedBytes: number;
  readonly maxReservedBytes: number;
  readonly remainingReservedBytes: number;
  readonly maxSourceBytes: number;
  readonly maxPosterBytes: number;
  readonly minDurationMs: number;
  readonly maxDurationMs: number;
  readonly itemLimitReached: boolean;
  readonly byteLimitReached: boolean;
  readonly canStartUpload: boolean;
  readonly calculatedAt: number;
}

const RESERVATIONS_COLLECTION = 'media_private_video_upload_reservations';
const CAPACITY_LOCK_COLLECTION = 'media_private_video_upload_capacity';
const ACTIVE_RESERVATION_MS = 30 * 60 * 1000;
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
  return normalized &&
    normalized.length <= 128 &&
    !normalized.includes('/') &&
    !containsControlCharacter(normalized)
    ? normalized
    : '';
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed))
    : 0;
}

function normalizeMimeType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function toMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    const millis = (value as { toMillis(): number }).toMillis();
    return Number.isFinite(millis) ? Math.trunc(millis) : null;
  }

  return null;
}

function reservationDocumentId(
  ownerUid: string,
  clientRequestId: string
): string {
  return createHash('sha256')
    .update(`${ownerUid}:${clientRequestId}`)
    .digest('hex');
}

function nextLockGeneration(snapshot: FirebaseFirestore.DocumentSnapshot): number {
  const current = Number(snapshot.data()?.['generation'] ?? 0);
  return Number.isFinite(current) && current >= 0
    ? Math.trunc(current) + 1
    : 1;
}

function sameReservationRequest(
  reservation: PrivateVideoUploadReservationDocument,
  input: {
    readonly clientRequestId: string;
    readonly ownerUid: string;
    readonly videoId: string;
    readonly videoStoragePath: string;
    readonly posterStoragePath: string | null;
    readonly videoSizeBytes: number;
    readonly posterSizeBytes: number;
    readonly sourceDurationMs: number;
    readonly mimeType: string;
  }
): boolean {
  return reservation.clientRequestId === input.clientRequestId &&
    reservation.ownerUid === input.ownerUid &&
    reservation.videoId === input.videoId &&
    reservation.videoStoragePath === input.videoStoragePath &&
    reservation.posterStoragePath === input.posterStoragePath &&
    reservation.videoSizeBytes === input.videoSizeBytes &&
    reservation.posterSizeBytes === input.posterSizeBytes &&
    reservation.sourceDurationMs === input.sourceDurationMs &&
    reservation.mimeType === input.mimeType;
}

function validateProductBoundary(input: {
  readonly videoSizeBytes: number;
  readonly posterSizeBytes: number;
  readonly sourceDurationMs: number;
}): void {
  const product = getPrivateVideoProductLimit();

  if (
    !input.videoSizeBytes ||
    input.videoSizeBytes > product.maxSourceBytes
  ) {
    throw new HttpsError(
      'invalid-argument',
      'O vídeo deve ter no máximo 80 MB.',
      {
        code: 'VIDEO_UPLOAD_SOURCE_SIZE_LIMIT',
        maxSourceBytes: product.maxSourceBytes,
        retryable: false,
      }
    );
  }

  if (input.posterSizeBytes > product.maxPosterBytes) {
    throw new HttpsError(
      'invalid-argument',
      'A capa excede o limite permitido.',
      {
        code: 'VIDEO_UPLOAD_POSTER_SIZE_LIMIT',
        maxPosterBytes: product.maxPosterBytes,
        retryable: false,
      }
    );
  }

  if (
    input.sourceDurationMs < product.minDurationMs ||
    input.sourceDurationMs > product.maxDurationMs
  ) {
    throw new HttpsError(
      'invalid-argument',
      'O vídeo deve ter entre 5 e 60 segundos.',
      {
        code: 'VIDEO_UPLOAD_DURATION_LIMIT',
        minDurationMs: product.minDurationMs,
        maxDurationMs: product.maxDurationMs,
        retryable: false,
      }
    );
  }
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
  capacity: PrivateVideoUploadCapacityResponse
): ReservePrivateVideoUploadResponse {
  return {
    reservationId: reservation.reservationId,
    ownerUid: reservation.ownerUid,
    videoId: reservation.videoId,
    plan: reservation.plan,
    expiresAt: reservation.expiresAt.toMillis(),
    reservedBytes: reservation.reservedBytes,
    maxItems: capacity.maxItems,
    maxReservedBytes: capacity.maxReservedBytes,
    currentItems: capacity.currentItems,
    currentReservedBytes: capacity.currentReservedBytes,
  };
}

export function buildPrivateVideoUploadCapacityResponse(input: {
  readonly user: Record<string, unknown>;
  readonly videos: ReadonlyArray<{
    readonly id: string;
    readonly data: Record<string, unknown>;
  }>;
  readonly reservations: ReadonlyArray<PrivateVideoCapacityReservation>;
  readonly now: number;
}): PrivateVideoUploadCapacityResponse {
  const plan = resolvePrivateVideoQuotaPlan(input.user, input.now);
  const quota = getPrivateVideoQuotaLimit(plan);
  const product = getPrivateVideoProductLimit();
  const registeredVideoIds = new Set(input.videos.map((video) => video.id));
  const currentRegisteredBytes = input.videos.reduce(
    (total, video) => total + estimateRegisteredVideoReservedBytes(video.data),
    0
  );
  const activeReservations = input.reservations.filter((reservation) => {
    const videoId = cleanId(reservation.videoId);
    const expiresAt = toMillis(reservation.expiresAt);

    return reservation.state === 'ACTIVE' &&
      expiresAt !== null &&
      expiresAt > input.now &&
      !!videoId &&
      !registeredVideoIds.has(videoId);
  });
  const currentItems = input.videos.length + activeReservations.length;
  const currentReservedBytes = currentRegisteredBytes +
    activeReservations.reduce(
      (total, reservation) =>
        total + normalizeNonNegativeInteger(reservation.reservedBytes),
      0
    );
  const remainingItems = Math.max(0, quota.maxItems - currentItems);
  const remainingReservedBytes = Math.max(
    0,
    quota.maxReservedBytes - currentReservedBytes
  );
  const itemLimitReached = remainingItems <= 0;
  const byteLimitReached = remainingReservedBytes <= 0;

  return {
    plan,
    currentItems,
    maxItems: quota.maxItems,
    remainingItems,
    currentReservedBytes,
    maxReservedBytes: quota.maxReservedBytes,
    remainingReservedBytes,
    maxSourceBytes: product.maxSourceBytes,
    maxPosterBytes: product.maxPosterBytes,
    minDurationMs: product.minDurationMs,
    maxDurationMs: product.maxDurationMs,
    itemLimitReached,
    byteLimitReached,
    canStartUpload: !itemLimitReached && !byteLimitReached,
    calculatedAt: input.now,
  };
}

export const getPrivateVideoUploadCapacity = onCall(
  { region: FUNCTIONS_REGION },
  async (request): Promise<PrivateVideoUploadCapacityResponse> => {
    const requesterUid = cleanId(request.auth?.uid);

    if (!requesterUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const user = await assertPrivateVideoUploadEligibility(requesterUid);
    const [videosSnapshot, reservationsSnapshot] = await Promise.all([
      db.collection(`users/${requesterUid}/videos`).get(),
      db.collection(RESERVATIONS_COLLECTION)
        .where('ownerUid', '==', requesterUid)
        .get(),
    ]);
    const now = Date.now();

    return buildPrivateVideoUploadCapacityResponse({
      user,
      videos: videosSnapshot.docs.map((document) => ({
        id: document.id,
        data: document.data(),
      })),
      reservations: reservationsSnapshot.docs.map(
        (document) => document.data() as PrivateVideoCapacityReservation
      ),
      now,
    });
  }
);

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
    const videoSizeBytes = normalizeNonNegativeInteger(
      request.data?.videoSizeBytes
    );
    const posterSizeBytes = normalizeNonNegativeInteger(
      request.data?.posterSizeBytes
    );
    const sourceDurationMs = normalizeNonNegativeInteger(
      request.data?.sourceDurationMs
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

    validateProductBoundary({
      videoSizeBytes,
      posterSizeBytes,
      sourceDurationMs,
    });

    const user = await assertPrivateVideoUploadEligibility(ownerUid);
    const now = Date.now();
    const reservationId = reservationDocumentId(ownerUid, clientRequestId);
    const reservationRef = db
      .collection(RESERVATIONS_COLLECTION)
      .doc(reservationId);
    const lockRef = db
      .collection(CAPACITY_LOCK_COLLECTION)
      .doc(ownerUid);
    const userRef = db.doc(`users/${ownerUid}`);
    const videosQuery = db.collection(`users/${ownerUid}/videos`);
    const reservationsQuery = db
      .collection(RESERVATIONS_COLLECTION)
      .where('ownerUid', '==', ownerUid);
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
      sourceDurationMs,
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
      const capacity = buildPrivateVideoUploadCapacityResponse({
        user: transactionalUser,
        videos: videosSnapshot.docs.map((document) => ({
          id: document.id,
          data: document.data(),
        })),
        reservations: reservationsSnapshot.docs.map(
          (document) => document.data() as PrivateVideoCapacityReservation
        ),
        now,
      });

      if (existingSnapshot.exists) {
        const existing = existingSnapshot.data() as
          PrivateVideoUploadReservationDocument;

        if (
          existing.state === 'ACTIVE' &&
          existing.expiresAt.toMillis() > now &&
          sameReservationRequest(existing, requestIdentity)
        ) {
          return buildReserveResponse(existing, capacity);
        }

        throw new HttpsError(
          'already-exists',
          'O identificador desta tentativa de upload já foi utilizado.'
        );
      }

      const decision = evaluatePrivateVideoQuota(
        capacity.plan,
        {
          currentItems: capacity.currentItems,
          currentReservedBytes: capacity.currentReservedBytes,
        },
        reservedBytes
      );

      if (!decision.allowed) {
        throw quotaHttpsError(decision.reason, {
          plan: capacity.plan,
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
        sourceDurationMs,
        mimeType,
        reservedBytes,
        plan: capacity.plan,
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

      return buildReserveResponse(reservation, capacity);
    });
  }
);
