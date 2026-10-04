// functions/src/media/application/public-media-age-expiry.policy.ts
// -----------------------------------------------------------------------------
// PUBLIC MEDIA SIGNED URL EXPIRY
// -----------------------------------------------------------------------------
// Compatibilidade de nome durante a migração. A expiração agora é puramente
// técnica: maioridade/assurance da conta não limita TTL de cada ativo.
// -----------------------------------------------------------------------------

export function resolvePublicMediaSignedUrlExpiresAt(input: {
  nowMs: number;
  technicalExpiresAtMs: number;
}): number | null {
  if (
    !Number.isFinite(input.nowMs) ||
    !Number.isFinite(input.technicalExpiresAtMs)
  ) {
    return null;
  }

  return input.technicalExpiresAtMs > input.nowMs
    ? Math.trunc(input.technicalExpiresAtMs)
    : null;
}
