// functions/src/media/application/public-media-signed-url-expiry.policy.ts
// -----------------------------------------------------------------------------
// PUBLIC MEDIA SIGNED URL EXPIRY
// -----------------------------------------------------------------------------
// A expiração é puramente técnica. Maioridade/assurance da conta não limita
// o TTL de cada ativo e não pertence à autoridade de distribuição de Media.
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
