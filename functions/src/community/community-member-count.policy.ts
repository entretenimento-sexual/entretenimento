// functions/src/community/community-member-count.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER COUNT POLICY
// -----------------------------------------------------------------------------
// Métricas de membership são projeções derivadas. Ausência, null, strings ou
// números inválidos nunca podem ser convertidos implicitamente em zero/um.
// O chamador só persiste uma nova contagem quando o estado atual é confiável.
// -----------------------------------------------------------------------------

export function normalizeCommunityMemberCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? Math.trunc(value)
    : null;
}

export function resolveCommunityMemberCountDelta(
  currentValue: unknown,
  delta: -1 | 1
): number | null {
  const current = normalizeCommunityMemberCount(currentValue);
  if (current === null) return null;

  return Math.max(current + delta, 0);
}
