export interface CommunityBoundedRenderWindow<T> {
  readonly items: readonly T[];
  readonly start: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function normalizeCommunityRenderWindowStart(
  totalItems: number,
  maxItems: number,
  requestedStart: number
): number {
  const total = normalizeCount(totalItems);
  const size = Math.max(1, normalizeCount(maxItems));
  const maxStart = Math.max(0, total - size);
  const requested = normalizeCount(requestedStart);

  return Math.min(requested, maxStart);
}

export function communityTailRenderWindowStart(
  totalItems: number,
  maxItems: number
): number {
  const total = normalizeCount(totalItems);
  const size = Math.max(1, normalizeCount(maxItems));
  return Math.max(0, total - size);
}

export function communityRenderWindowStartForIndex(
  totalItems: number,
  maxItems: number,
  itemIndex: number
): number {
  const total = normalizeCount(totalItems);
  const size = Math.max(1, normalizeCount(maxItems));
  const safeIndex = Math.min(
    Math.max(0, normalizeCount(itemIndex)),
    Math.max(0, total - 1)
  );
  const preferredOffset = Math.min(
    Math.floor(size / 3),
    Math.max(0, size - 1)
  );

  return normalizeCommunityRenderWindowStart(
    total,
    size,
    Math.max(0, safeIndex - preferredOffset)
  );
}

export function buildCommunityBoundedRenderWindow<T>(
  items: readonly T[],
  maxItems: number,
  requestedStart: number
): CommunityBoundedRenderWindow<T> {
  const total = items.length;
  const size = Math.max(1, normalizeCount(maxItems));
  const start = normalizeCommunityRenderWindowStart(
    total,
    size,
    requestedStart
  );
  const end = Math.min(total, start + size);

  return {
    items: items.slice(start, end),
    start,
    hasPrevious: start > 0,
    hasNext: end < total,
  };
}
