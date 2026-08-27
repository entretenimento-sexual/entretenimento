// functions/src/community/community-membership-activity.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP ACTIVITY POLICY
// -----------------------------------------------------------------------------
// Define quais transições de membership representam atividade significativa
// para o ciclo de vida da Comunidade. Solicitações pendentes isoladas não mantêm
// uma Comunidade viva; entrada, aprovação, saída/bloqueio de membro ativo sim.
// -----------------------------------------------------------------------------

export type CommunityActivityMembershipStatus =
  | 'active'
  | 'pending'
  | 'blocked'
  | 'left'
  | null;

function normalizeStatus(value: unknown): CommunityActivityMembershipStatus {
  return value === 'active'
    || value === 'pending'
    || value === 'blocked'
    || value === 'left'
    ? value
    : null;
}

export function isCommunityMembershipTransitionMeaningful(
  rawBefore: unknown,
  rawAfter: unknown
): boolean {
  const before = (rawBefore ?? {}) as Record<string, unknown>;
  const after = (rawAfter ?? {}) as Record<string, unknown>;
  const beforeStatus = normalizeStatus(before['status']);
  const afterStatus = normalizeStatus(after['status']);

  if (beforeStatus === afterStatus) return false;

  return beforeStatus === 'active' || afterStatus === 'active';
}
