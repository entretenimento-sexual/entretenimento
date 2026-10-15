/** A stale/missing projection must never be treated as media authorization. */
export function resolvePublicMediaAvailability(data: unknown): boolean | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const value = data as Record<string, unknown>;
  return value['version'] === 1 && typeof value['available'] === 'boolean'
    ? value['available'] : null;
}
