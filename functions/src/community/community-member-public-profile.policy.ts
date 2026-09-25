// functions/src/community/community-member-public-profile.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER PUBLIC PROFILE POLICY
// -----------------------------------------------------------------------------
// Fronteira compartilhada entre roster e busca interna. Uma projeção de índice
// jamais basta para exibir um membro: o perfil público precisa continuar adulto
// verificado e dentro da validade no instante da leitura.
// -----------------------------------------------------------------------------

function timestampToMillis(value: unknown): number | null {
  if (
    value
    && typeof value === 'object'
    && typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    try {
      const millis = (value as { toMillis: () => number }).toMillis();
      return Number.isFinite(millis) ? millis : null;
    } catch {
      return null;
    }
  }

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function isCurrentCommunityMemberPublicProfile(
  profile: Record<string, unknown> | null | undefined,
  nowMs: number
): boolean {
  if (!profile || profile['ageEligibilityVerifiedAdult'] !== true) {
    return false;
  }

  const validUntilMs = timestampToMillis(profile['ageEligibilityValidUntil']);
  return validUntilMs !== null && validUntilMs > nowMs;
}
