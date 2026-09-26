// functions/src/account_lifecycle/account-suspension-expiry.policy.ts
// -----------------------------------------------------------------------------
// ACCOUNT SUSPENSION EXPIRY POLICY
// -----------------------------------------------------------------------------
// Determina quando uma suspensão temporária aplicada pela moderação pode ser
// encerrada automaticamente pelo relógio. Estado desconhecido permanece
// fail-closed.
// -----------------------------------------------------------------------------

export interface ModerationSuspensionExpiryDecision {
  due: boolean;
  suspensionEndsAt: number | null;
  reason:
    | 'due'
    | 'not_moderation_suspended'
    | 'no_expiry'
    | 'not_due';
}

function finiteEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : null;
}

export function evaluateModerationSuspensionExpiry(input: {
  accountStatus: unknown;
  suspensionEndsAt: unknown;
  now: number;
}): ModerationSuspensionExpiryDecision {
  if (String(input.accountStatus ?? '').trim() !== 'moderation_suspended') {
    return {
      due: false,
      suspensionEndsAt: finiteEpoch(input.suspensionEndsAt),
      reason: 'not_moderation_suspended',
    };
  }

  const suspensionEndsAt = finiteEpoch(input.suspensionEndsAt);
  if (suspensionEndsAt === null) {
    return {
      due: false,
      suspensionEndsAt: null,
      reason: 'no_expiry',
    };
  }

  if (!Number.isFinite(input.now) || input.now < suspensionEndsAt) {
    return {
      due: false,
      suspensionEndsAt,
      reason: 'not_due',
    };
  }

  return {
    due: true,
    suspensionEndsAt,
    reason: 'due',
  };
}
