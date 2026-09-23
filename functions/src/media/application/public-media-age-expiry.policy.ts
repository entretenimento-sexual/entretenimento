// functions/src/media/application/public-media-age-expiry.policy.ts
// -----------------------------------------------------------------------------
// PUBLIC MEDIA AGE EXPIRY
// -----------------------------------------------------------------------------
// Helpers puros para manter projeção pública e URL temporária limitadas pelo
// menor relógio etário aplicável. Nenhuma decisão de maioridade nasce aqui:
// status/canonical allowance continuam resolvidos pelos boundaries superiores.
// -----------------------------------------------------------------------------

export function publicAgeProjectionValidUntilMs(
  data: Record<string, unknown> | undefined
): number | null {
  if (data?.['ageEligibilityVerifiedAdult'] !== true) return null;

  const validUntil = data?.['ageEligibilityValidUntil'] as
    | { toMillis?: unknown }
    | null
    | undefined;

  if (!validUntil || typeof validUntil.toMillis !== 'function') {
    return null;
  }

  try {
    const value = (validUntil as { toMillis: () => number }).toMillis();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function resolvePublicMediaSignedUrlExpiresAt(input: {
  nowMs: number;
  technicalExpiresAtMs: number;
  viewerExpiresAtMs: number;
  ownerExpiresAtMs: number;
  mediaExpiresAtMs: number;
}): number | null {
  const candidates = [
    input.nowMs,
    input.technicalExpiresAtMs,
    input.viewerExpiresAtMs,
    input.ownerExpiresAtMs,
    input.mediaExpiresAtMs,
  ];

  if (candidates.some((value) => !Number.isFinite(value))) {
    // Infinity é aceito somente como "sem expiração canônica" dos boundaries
    // superiores; o TTL técnico continua obrigatoriamente finito.
    if (
      !Number.isFinite(input.nowMs) ||
      !Number.isFinite(input.technicalExpiresAtMs) ||
      Number.isNaN(input.viewerExpiresAtMs) ||
      Number.isNaN(input.ownerExpiresAtMs) ||
      !Number.isFinite(input.mediaExpiresAtMs)
    ) {
      return null;
    }
  }

  const expiresAt = Math.min(
    input.technicalExpiresAtMs,
    input.viewerExpiresAtMs,
    input.ownerExpiresAtMs,
    input.mediaExpiresAtMs
  );

  return Number.isFinite(expiresAt) && expiresAt > input.nowMs
    ? Math.trunc(expiresAt)
    : null;
}
