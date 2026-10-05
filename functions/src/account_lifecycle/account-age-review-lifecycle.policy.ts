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
