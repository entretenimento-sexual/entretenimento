export type CanonicalOwnerLifecycleDenialReason =
  | 'OWNER_ACCOUNT_MISSING'
  | 'OWNER_ACCOUNT_INACTIVE'
  | 'OWNER_ACCOUNT_SUSPENDED'
  | 'OWNER_ACCOUNT_HIDDEN'
  | 'OWNER_LOGIN_DISABLED';

export interface CanonicalOwnerLifecycleDecision {
  readonly allowed: boolean;
  readonly denialReason: CanonicalOwnerLifecycleDenialReason | null;
}

type OwnerLifecycleUserDocument = {
  accountStatus?: unknown;
  suspended?: unknown;
  publicVisibility?: unknown;
  loginAllowed?: unknown;
};

export function evaluateCanonicalOwnerLifecycle(
  user: OwnerLifecycleUserDocument | null | undefined
): CanonicalOwnerLifecycleDecision {
  if (!user) {
    return {
      allowed: false,
      denialReason: 'OWNER_ACCOUNT_MISSING',
    };
  }

  const accountStatus = String(user.accountStatus ?? 'active')
    .trim()
    .toLowerCase();

  if (accountStatus !== 'active') {
    return {
      allowed: false,
      denialReason: 'OWNER_ACCOUNT_INACTIVE',
    };
  }

  if (user.suspended === true) {
    return {
      allowed: false,
      denialReason: 'OWNER_ACCOUNT_SUSPENDED',
    };
  }

  if (String(user.publicVisibility ?? 'visible').trim().toLowerCase() === 'hidden') {
    return {
      allowed: false,
      denialReason: 'OWNER_ACCOUNT_HIDDEN',
    };
  }

  if (user.loginAllowed === false) {
    return {
      allowed: false,
      denialReason: 'OWNER_LOGIN_DISABLED',
    };
  }

  return {
    allowed: true,
    denialReason: null,
  };
}
