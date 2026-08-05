import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import { assertPrivateVideoUploadEligibility } from './private-video-upload-eligibility.service';
import {
  estimateRegisteredVideoReservedBytes,
  getPrivateVideoProductLimit,
  getPrivateVideoQuotaLimit,
  resolvePrivateVideoQuotaPlan,
  type PrivateVideoQuotaPlan,
} from './private-video-upload-quota.policy';

interface PrivateVideoCapacityReservation {
  readonly ownerUid?: unknown;
  readonly videoId?: unknown;
  readonly state?: unknown;
  readonly reservedBytes?: unknown;
  readonly expiresAt?: unknown;
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

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized &&
    normalized.length <= 128 &&
    !normalized.includes('/')
    ? normalized
    : '';
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed))
    : 0;
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
