import {
  resolveCurrentTrustedAdultAgeProjection,
} from '../../account_lifecycle/trusted-adult-account-assurance.policy';

export type CanonicalOwnerLifecycleDenialReason =
  | 'OWNER_ACCOUNT_MISSING'
  | 'OWNER_ACCOUNT_INACTIVE'
  | 'OWNER_ACCOUNT_SUSPENDED'
  | 'OWNER_ACCOUNT_HIDDEN'
  | 'OWNER_LOGIN_DISABLED'
  | 'OWNER_ACCOUNT_ASSURANCE_REQUIRED';

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
  ageEligibility?: unknown;
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
  nowMs = Date.now()
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

  const assurance = resolveCurrentTrustedAdultAgeProjection(user, nowMs);
  if (!assurance.allowed) {
    return denied('OWNER_ACCOUNT_ASSURANCE_REQUIRED');
  }

  return {
    allowed: true,
    denialReason: null,
    accessExpiresAtMs: assurance.accessExpiresAtMs,
  };
}
