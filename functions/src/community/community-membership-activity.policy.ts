// functions/src/community/community-membership-activity.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP ACTIVITY POLICY
// -----------------------------------------------------------------------------
// Mantém frescor apenas na primeira ativação daquele participante na Comunidade.
// Saída, bloqueio, desbloqueio e reentrada continuam alterando membership/métricas,
// mas não podem renovar indefinidamente a vantagem de descoberta por churn.
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

function hasActivationHistory(rawMembership: unknown): boolean {
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  return membership['joinedAt'] !== null
    && membership['joinedAt'] !== undefined;
}

export function isCommunityMembershipTransitionMeaningful(
  rawBefore: unknown,
  rawAfter: unknown
): boolean {
  const before = (rawBefore ?? {}) as Record<string, unknown>;
  const after = (rawAfter ?? {}) as Record<string, unknown>;
  const beforeStatus = normalizeStatus(before['status']);
  const afterStatus = normalizeStatus(after['status']);

  if (beforeStatus === afterStatus || afterStatus !== 'active') return false;

  return !hasActivationHistory(rawBefore);
}
