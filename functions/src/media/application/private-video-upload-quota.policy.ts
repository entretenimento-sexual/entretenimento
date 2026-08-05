export type PrivateVideoQuotaPlan = 'free' | 'basic' | 'premium' | 'vip';

export interface PrivateVideoQuotaLimit {
  readonly maxItems: number;
  readonly maxReservedBytes: number;
}

export interface PrivateVideoProductLimit {
  readonly maxSourceBytes: number;
  readonly maxPosterBytes: number;
  readonly minDurationMs: number;
  readonly maxDurationMs: number;
}

export interface PrivateVideoQuotaUsage {
  readonly currentItems: number;
  readonly currentReservedBytes: number;
}

export type PrivateVideoQuotaDecision =
  | {
      readonly allowed: true;
      readonly reason: 'ALLOWED';
      readonly usage: PrivateVideoQuotaUsage;
      readonly nextItems: number;
      readonly nextReservedBytes: number;
      readonly limit: PrivateVideoQuotaLimit;
    }
  | {
      readonly allowed: false;
      readonly reason: 'ITEM_LIMIT' | 'BYTE_LIMIT';
      readonly usage: PrivateVideoQuotaUsage;
      readonly nextItems: number;
      readonly nextReservedBytes: number;
      readonly limit: PrivateVideoQuotaLimit;
    };

const MIB = 1024 * 1024;
const GIB = 1024 * MIB;

export const PRIVATE_VIDEO_PRODUCT_LIMIT: PrivateVideoProductLimit = {
  maxSourceBytes: 80 * MIB,
  maxPosterBytes: 5 * MIB,
  minDurationMs: 5_000,
  maxDurationMs: 60_000,
};

const LIMITS: Readonly<Record<PrivateVideoQuotaPlan, PrivateVideoQuotaLimit>> = {
  free: {
    maxItems: 1,
    maxReservedBytes: 180 * MIB,
  },
  basic: {
    maxItems: 3,
    maxReservedBytes: 540 * MIB,
  },
  premium: {
    maxItems: 8,
    maxReservedBytes: Math.trunc(1.5 * GIB),
  },
  vip: {
    maxItems: 15,
    maxReservedBytes: 3 * GIB,
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

export function resolvePrivateVideoQuotaPlan(
  user: Record<string, unknown> | null | undefined,
  now = Date.now()
): PrivateVideoQuotaPlan {
  const role = String(user?.['tier'] ?? user?.['role'] ?? '')
    .trim()
    .toLowerCase();

  if (role === 'admin') {
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
    startsAt === null ||
    endsAt === null ||
    startsAt >= endsAt ||
    now < startsAt ||
    now >= endsAt
  ) {
    return 'free';
  }

  return role === 'basic' || role === 'premium' || role === 'vip'
    ? role
    : 'free';
}

export function getPrivateVideoQuotaLimit(
  plan: PrivateVideoQuotaPlan
): PrivateVideoQuotaLimit {
  return { ...LIMITS[plan] };
}

export function getPrivateVideoProductLimit(): PrivateVideoProductLimit {
  return { ...PRIVATE_VIDEO_PRODUCT_LIMIT };
}

export function calculatePrivateVideoReservationBytes(
  sourceSizeBytes: unknown,
  posterSizeBytes: unknown = 0
): number {
  const source = normalizeNonNegativeInteger(sourceSizeBytes);
  const poster = normalizeNonNegativeInteger(posterSizeBytes);

  return Math.min(Number.MAX_SAFE_INTEGER, source * 2 + poster);
}

export function estimateRegisteredVideoReservedBytes(
  video: Record<string, unknown>
): number {
  const persistedReservation = normalizeNonNegativeInteger(
    video['quotaReservedBytes']
  );

  if (persistedReservation > 0) {
    return persistedReservation;
  }

  const sourceSize = normalizeNonNegativeInteger(
    video['sourceSizeBytes'] ?? video['sizeBytes']
  );
  const processedSize = normalizeNonNegativeInteger(
    video['processedSizeBytes']
  );
  const posterSize = normalizeNonNegativeInteger(video['posterSizeBytes']);

  if (sourceSize <= 0) {
    return 0;
  }

  return Math.min(
    Number.MAX_SAFE_INTEGER,
    sourceSize + Math.max(sourceSize, processedSize) + posterSize
  );
}

export function evaluatePrivateVideoQuota(
  plan: PrivateVideoQuotaPlan,
  usage: PrivateVideoQuotaUsage,
  requestedReservedBytes: unknown
): PrivateVideoQuotaDecision {
  const limit = getPrivateVideoQuotaLimit(plan);
  const currentItems = normalizeNonNegativeInteger(usage.currentItems);
  const currentReservedBytes = normalizeNonNegativeInteger(
    usage.currentReservedBytes
  );
  const reservationBytes = normalizeNonNegativeInteger(
    requestedReservedBytes
  );
  const normalizedUsage = { currentItems, currentReservedBytes };
  const nextItems = currentItems + 1;
  const nextReservedBytes = currentReservedBytes + reservationBytes;

  if (nextItems > limit.maxItems) {
    return {
      allowed: false,
      reason: 'ITEM_LIMIT',
      usage: normalizedUsage,
      nextItems,
      nextReservedBytes,
      limit,
    };
  }

  if (nextReservedBytes > limit.maxReservedBytes) {
    return {
      allowed: false,
      reason: 'BYTE_LIMIT',
      usage: normalizedUsage,
      nextItems,
      nextReservedBytes,
      limit,
    };
  }

  return {
    allowed: true,
    reason: 'ALLOWED',
    usage: normalizedUsage,
    nextItems,
    nextReservedBytes,
    limit,
  };
}
