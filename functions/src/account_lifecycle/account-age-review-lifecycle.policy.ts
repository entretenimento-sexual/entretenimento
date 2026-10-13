// functions/src/account_lifecycle/account-age-review-lifecycle.policy.ts
// -----------------------------------------------------------------------------
// ACCOUNT LIFECYCLE / AGE REVIEW CONSEQUENCES
// -----------------------------------------------------------------------------
// Compliance decide evidência e resultado da revalidação.
// Account Lifecycle define como essa decisão restringe/restaura/suspende a conta.
// Media, Discovery e demais superfícies apenas consomem o lifecycle resultante.
// -----------------------------------------------------------------------------

export function buildAgeReviewRestrictionPatch(input: {
  restrictedAt: number;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    publicVisibility: 'hidden',
    interactionBlocked: true,
    ageReverificationRestrictedAt: input.restrictedAt,
  });
}

/**
 * Restore only a restriction demonstrably owned by this age-review case.
 * Independent lifecycle locks and active automation holds take precedence.
 * Historical records without the ownership marker remain restricted.
 */
export function resolveAgeReviewRestoration(input: {
  caseId: string;
  account: {
    accountStatus?: unknown;
    suspended?: unknown;
    suspensionSource?: unknown;
    ageReverificationSuspensionCaseId?: unknown;
    ageReverificationRestrictedAt?: unknown;
    accountLocked?: unknown;
    loginAllowed?: unknown;
    interactionBlocked?: unknown;
    publicVisibility?: unknown;
    moderationAutomationHold?: { active?: unknown } | null;
  };
}): { canRestore: boolean; ownsSuspension: boolean } {
  const user = input.account;
  const ownsSuspension = !!input.caseId &&
    user.ageReverificationSuspensionCaseId === input.caseId;
  const restrictedAt = Number(user.ageReverificationRestrictedAt);
  const hasAgeRestriction = Number.isFinite(restrictedAt) && restrictedAt > 0 &&
    user.interactionBlocked === true &&
    user.publicVisibility === 'hidden';
  const independentlyRestricted = user.accountLocked === true ||
    user.loginAllowed === false ||
    user.moderationAutomationHold?.active === true;
  const status = String(user.accountStatus ?? 'active').trim().toLowerCase();
  const correctSuspension = ownsSuspension
    ? status === 'moderation_suspended' && user.suspended === true &&
      user.suspensionSource === 'moderator'
    : status === 'active' && user.suspended !== true;

  return {
    canRestore: hasAgeRestriction && !independentlyRestricted && correctSuspension,
    ownsSuspension,
  };
}

export function buildAgeReviewRestorePatch(input: {
  reviewedAt: number;
  reviewedBy: string;
  ownsSuspension: boolean;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    publicVisibility: 'visible',
    interactionBlocked: false,
    ageReverificationRestrictedAt: null,
    ...(input.ownsSuspension
      ? {
        accountStatus: 'active',
        suspended: false,
        suspensionReason: null,
        suspensionSource: null,
        suspensionEndsAt: null,
        suspendedAtMs: null,
        suspendedBy: null,
        statusUpdatedAt: input.reviewedAt,
        statusUpdatedBy: input.reviewedBy,
        ageReverificationSuspensionCaseId: null,
      }
      : {}),
  });
}

export function buildConfirmedUnderageSuspensionPatch(input: {
  reviewedAt: number;
  reviewedBy: string;
  reason: string;
  caseId: string;
}): Readonly<Record<string, unknown>> {
  return Object.freeze({
    accountStatus: 'moderation_suspended',
    publicVisibility: 'hidden',
    interactionBlocked: true,
    loginAllowed: true,
    suspended: true,
    suspensionReason: input.reason,
    suspensionSource: 'moderator',
    suspendedAtMs: input.reviewedAt,
    suspendedBy: input.reviewedBy,
    ageReverificationSuspensionCaseId: input.caseId,
    statusUpdatedAt: input.reviewedAt,
    statusUpdatedBy: input.reviewedBy,
  });
}
