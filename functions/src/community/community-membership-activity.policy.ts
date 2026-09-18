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
  | 'left';

type CommunityActivityMembershipState =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{
    kind: 'valid';
    status: CommunityActivityMembershipStatus;
  }>
  | Readonly<{ kind: 'invalid' }>;

function classifyMembershipState(
  rawMembership: unknown
): CommunityActivityMembershipState {
  if (rawMembership === null || rawMembership === undefined) {
    return { kind: 'absent' };
  }

  if (
    typeof rawMembership !== 'object'
    || Array.isArray(rawMembership)
  ) {
    return { kind: 'invalid' };
  }

  const membership = rawMembership as Record<string, unknown>;
  const status = membership['status'];

  return status === 'active'
    || status === 'pending'
    || status === 'blocked'
    || status === 'left'
    ? { kind: 'valid', status }
    : { kind: 'invalid' };
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
  const beforeState = classifyMembershipState(rawBefore);
  const afterState = classifyMembershipState(rawAfter);

  if (
    afterState.kind !== 'valid'
    || afterState.status !== 'active'
    || beforeState.kind === 'invalid'
    || (
      beforeState.kind === 'valid'
      && beforeState.status === 'active'
    )
  ) {
    return false;
  }

  return !hasActivationHistory(rawBefore);
}
