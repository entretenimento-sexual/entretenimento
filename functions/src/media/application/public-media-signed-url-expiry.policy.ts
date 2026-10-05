export function resolvePublicMediaSignedUrlExpiresAt(input: {
  nowMs: number;
  technicalExpiresAtMs: number;
  requesterAccessExpiresAtMs?: number | null;
  ownerAccessExpiresAtMs?: number | null;
}): number | null {
  if (
    !Number.isFinite(input.nowMs) ||
    !Number.isFinite(input.technicalExpiresAtMs) ||
    input.technicalExpiresAtMs <= input.nowMs
  ) {
    return null;
  }

  const deadlines = [
    input.technicalExpiresAtMs,
    input.requesterAccessExpiresAtMs,
    input.ownerAccessExpiresAtMs,
  ].filter(
    (value): value is number =>
      typeof value === 'number' && Number.isFinite(value)
  );

  if (deadlines.some((value) => value <= input.nowMs)) {
    return null;
  }

  return Math.trunc(Math.min(...deadlines));
}
