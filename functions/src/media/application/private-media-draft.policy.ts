export type PrivateMediaDraftKind = 'photo' | 'video';
export type PrivateMediaDraftPlan = 'free' | 'basic' | 'premium' | 'vip';

export interface PrivateMediaDraftLimit {
  maxItems: number;
  maxReservedBytes: number;
  retentionMs: number;
}

export interface PrivateMediaDraftUsage {
  photoCount: number;
  photoReservedBytes: number;
  videoCount: number;
  videoReservedBytes: number;
}

export interface PrivateMediaDraftCapacityDecision {
  allowed: boolean;
  reason: 'ALLOWED' | 'ITEM_LIMIT' | 'BYTE_LIMIT';
  currentItems: number;
  currentReservedBytes: number;
  nextItems: number;
  nextReservedBytes: number;
  limit: PrivateMediaDraftLimit;
}

export const PRIVATE_MEDIA_DRAFT_LIFECYCLE_VERSION = 1;
export const PRIVATE_MEDIA_DRAFT_USAGE_VERSION = 1;
export const PRIVATE_MEDIA_DRAFT_FREE_RETENTION_MS = 72 * 60 * 60 * 1000;
export const PRIVATE_MEDIA_DRAFT_PAID_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

const LIMITS: Record<
  PrivateMediaDraftPlan,
  Record<PrivateMediaDraftKind, PrivateMediaDraftLimit>
> = {
  free: {
    photo: {
      maxItems: 3,
      maxReservedBytes: 30 * MIB,
      retentionMs: PRIVATE_MEDIA_DRAFT_FREE_RETENTION_MS,
    },
    video: {
      maxItems: 1,
      maxReservedBytes: 800 * MIB,
      retentionMs: PRIVATE_MEDIA_DRAFT_FREE_RETENTION_MS,
    },
  },
  basic: {
    photo: {
      maxItems: 12,
      maxReservedBytes: 120 * MIB,
      retentionMs: PRIVATE_MEDIA_DRAFT_PAID_RETENTION_MS,
    },
    video: {
      maxItems: 2,
      maxReservedBytes: 2 * GIB,
      retentionMs: PRIVATE_MEDIA_DRAFT_PAID_RETENTION_MS,
    },
  },
  premium: {
    photo: {
      maxItems: 30,
      maxReservedBytes: 300 * MIB,
      retentionMs: PRIVATE_MEDIA_DRAFT_PAID_RETENTION_MS,
    },
    video: {
      maxItems: 5,
      maxReservedBytes: 5 * GIB,
      retentionMs: PRIVATE_MEDIA_DRAFT_PAID_RETENTION_MS,
    },
  },
  vip: {
    photo: {
      maxItems: 60,
      maxReservedBytes: 600 * MIB,
      retentionMs: PRIVATE_MEDIA_DRAFT_PAID_RETENTION_MS,
    },
    video: {
      maxItems: 10,
      maxReservedBytes: 10 * GIB,
      retentionMs: PRIVATE_MEDIA_DRAFT_PAID_RETENTION_MS,
    },
  },
};

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(parsed));
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

export function normalizePrivateMediaDraftUsage(
  value: unknown
): PrivateMediaDraftUsage {
  const candidate = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};

  return {
    photoCount: normalizeNonNegativeInteger(candidate['photoCount']),
    photoReservedBytes: normalizeNonNegativeInteger(
      candidate['photoReservedBytes']
    ),
    videoCount: normalizeNonNegativeInteger(candidate['videoCount']),
    videoReservedBytes: normalizeNonNegativeInteger(
      candidate['videoReservedBytes']
    ),
  };
}

export function resolvePrivateMediaDraftPlan(
  user: Record<string, unknown> | null | undefined,
  now = Date.now()
): PrivateMediaDraftPlan {
  if (user?.['role'] === 'admin') {
    return 'vip';
  }

  if (
    user?.['billingProjectionVersion'] !== 1 ||
    user?.['isSubscriber'] !== true ||
    user?.['subscriptionStatus'] !== 'active' ||
    user?.['subscriptionScope'] !== 'platform_subscription'
  ) {
    return 'free';
  }

  const startsAt = toMillis(user?.['subscriptionStartedAt']);
  const endsAt = toMillis(
    user?.['subscriptionEndsAt'] ?? user?.['subscriptionExpires']
  );

  if (
    (startsAt !== null && startsAt > now) ||
    endsAt === null ||
    endsAt <= now
  ) {
    return 'free';
  }

  const requestedPlan = String(user?.['tier'] ?? user?.['role'] ?? '')
    .trim()
    .toLowerCase();

  if (
    requestedPlan === 'basic' ||
    requestedPlan === 'premium' ||
    requestedPlan === 'vip'
  ) {
    return requestedPlan;
  }

  return 'free';
}

export function getPrivateMediaDraftLimit(
  kind: PrivateMediaDraftKind,
  plan: PrivateMediaDraftPlan
): PrivateMediaDraftLimit {
  return { ...LIMITS[plan][kind] };
}

export function calculatePrivateMediaDraftExpiry(
  kind: PrivateMediaDraftKind,
  plan: PrivateMediaDraftPlan,
  now = Date.now()
): number {
  return now + getPrivateMediaDraftLimit(kind, plan).retentionMs;
}

export function calculatePrivateMediaDraftReservationBytes(
  kind: PrivateMediaDraftKind,
  sourceSizeBytes: unknown,
  auxiliarySizeBytes: unknown = 0
): number {
  const source = normalizeNonNegativeInteger(sourceSizeBytes);
  const auxiliary = normalizeNonNegativeInteger(auxiliarySizeBytes);

  if (kind === 'video') {
    // Reserva o original e uma margem equivalente para o MP4 processado.
    return Math.min(Number.MAX_SAFE_INTEGER, source * 2 + auxiliary);
  }

  return Math.min(Number.MAX_SAFE_INTEGER, source + auxiliary);
}

export function evaluatePrivateMediaDraftCapacity(
  kind: PrivateMediaDraftKind,
  plan: PrivateMediaDraftPlan,
  usageValue: unknown,
  reservationBytesValue: unknown
): PrivateMediaDraftCapacityDecision {
  const usage = normalizePrivateMediaDraftUsage(usageValue);
  const reservationBytes = normalizeNonNegativeInteger(
    reservationBytesValue
  );
  const limit = getPrivateMediaDraftLimit(kind, plan);
  const currentItems = kind === 'photo'
    ? usage.photoCount
    : usage.videoCount;
  const currentReservedBytes = kind === 'photo'
    ? usage.photoReservedBytes
    : usage.videoReservedBytes;
  const nextItems = currentItems + 1;
  const nextReservedBytes = currentReservedBytes + reservationBytes;

  if (nextItems > limit.maxItems) {
    return {
      allowed: false,
      reason: 'ITEM_LIMIT',
      currentItems,
      currentReservedBytes,
      nextItems,
      nextReservedBytes,
      limit,
    };
  }

  if (nextReservedBytes > limit.maxReservedBytes) {
    return {
      allowed: false,
      reason: 'BYTE_LIMIT',
      currentItems,
      currentReservedBytes,
      nextItems,
      nextReservedBytes,
      limit,
    };
  }

  return {
    allowed: true,
    reason: 'ALLOWED',
    currentItems,
    currentReservedBytes,
    nextItems,
    nextReservedBytes,
    limit,
  };
}

export function applyPrivateMediaDraftReservation(
  kind: PrivateMediaDraftKind,
  usageValue: unknown,
  reservationBytesValue: unknown
): PrivateMediaDraftUsage {
  const usage = normalizePrivateMediaDraftUsage(usageValue);
  const reservationBytes = normalizeNonNegativeInteger(
    reservationBytesValue
  );

  if (kind === 'photo') {
    return {
      ...usage,
      photoCount: usage.photoCount + 1,
      photoReservedBytes: usage.photoReservedBytes + reservationBytes,
    };
  }

  return {
    ...usage,
    videoCount: usage.videoCount + 1,
    videoReservedBytes: usage.videoReservedBytes + reservationBytes,
  };
}

export function releasePrivateMediaDraftReservation(
  kind: PrivateMediaDraftKind,
  usageValue: unknown,
  reservationBytesValue: unknown
): PrivateMediaDraftUsage {
  const usage = normalizePrivateMediaDraftUsage(usageValue);
  const reservationBytes = normalizeNonNegativeInteger(
    reservationBytesValue
  );

  if (kind === 'photo') {
    return {
      ...usage,
      photoCount: Math.max(0, usage.photoCount - 1),
      photoReservedBytes: Math.max(
        0,
        usage.photoReservedBytes - reservationBytes
      ),
    };
  }

  return {
    ...usage,
    videoCount: Math.max(0, usage.videoCount - 1),
    videoReservedBytes: Math.max(
      0,
      usage.videoReservedBytes - reservationBytes
    ),
  };
}
