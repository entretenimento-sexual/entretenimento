export type CanonicalOwnerLifecycleDenialReason =
  | 'OWNER_ACCOUNT_MISSING'
  | 'OWNER_ACCOUNT_INACTIVE'
  | 'OWNER_ACCOUNT_SUSPENDED'
  | 'OWNER_ACCOUNT_HIDDEN'
  | 'OWNER_LOGIN_DISABLED';

export interface CanonicalOwnerLifecycleDecision {
  readonly allowed: boolean;
  readonly denialReason: CanonicalOwnerLifecycleDenialReason | null;
  readonly accessExpiresAtMs: number | null;
}

type OwnerLifecycleUserDocument = {
  accountStatus?: unknown;
  suspended?: unknown;
  publicVisibility?: unknown;
  loginAllowed?: unknown;
};

function denied(
  denialReason: CanonicalOwnerLifecycleDenialReason
): CanonicalOwnerLifecycleDecision {
  return {
    allowed: false,
    denialReason,
    accessExpiresAtMs: null,
  };
}

export function evaluateCanonicalOwnerLifecycle(
  user: OwnerLifecycleUserDocument | null | undefined,
  _nowMs = Date.now()
): CanonicalOwnerLifecycleDecision {
  if (!user) return denied('OWNER_ACCOUNT_MISSING');

  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  if (accountStatus !== 'active') return denied('OWNER_ACCOUNT_INACTIVE');
  if (user.suspended === true) return denied('OWNER_ACCOUNT_SUSPENDED');

  if (
    String(user.publicVisibility ?? 'visible')
      .trim()
      .toLowerCase() === 'hidden'
  ) {
    return denied('OWNER_ACCOUNT_HIDDEN');
  }

  if (user.loginAllowed === false) return denied('OWNER_LOGIN_DISABLED');

  return {
    allowed: true,
    denialReason: null,
    accessExpiresAtMs: null,
  };
}
