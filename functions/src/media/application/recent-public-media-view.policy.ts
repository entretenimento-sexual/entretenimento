export const RECENT_PUBLIC_MEDIA_VIEW_WINDOW_MS = 48 * 60 * 60 * 1000;

export function isRecentPublicMediaView(input: {
  lastViewedAt: unknown;
  now?: number;
  windowMs?: number;
}): boolean {
  const suppliedNow = input.now;
  const now = typeof suppliedNow === 'number' && Number.isFinite(suppliedNow)
    ? Math.floor(suppliedNow)
    : Date.now();
  const suppliedWindowMs = input.windowMs;
  const windowMs = typeof suppliedWindowMs === 'number' &&
      Number.isFinite(suppliedWindowMs) &&
      suppliedWindowMs > 0
    ? Math.floor(suppliedWindowMs)
    : RECENT_PUBLIC_MEDIA_VIEW_WINDOW_MS;
  const lastViewedAt = toMillis(input.lastViewedAt);

  if (lastViewedAt <= 0 || lastViewedAt > now) {
    return false;
  }

  return now - lastViewedAt <= windowMs;
}

function toMillis(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }

  if (value instanceof Date) {
    return Math.max(0, value.getTime());
  }

  const timestampLike = value as {
    toMillis?: () => number;
    seconds?: unknown;
    _seconds?: unknown;
  } | null | undefined;

  if (typeof timestampLike?.toMillis === 'function') {
    const millis = timestampLike.toMillis();
    return Number.isFinite(millis) ? Math.max(0, Math.floor(millis)) : 0;
  }

  const seconds = Number(
    timestampLike?.seconds ?? timestampLike?._seconds ?? 0
  );

  return Number.isFinite(seconds) && seconds > 0
    ? Math.floor(seconds * 1000)
    : 0;
}
