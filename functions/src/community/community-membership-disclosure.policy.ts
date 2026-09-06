// functions/src/community/community-membership-disclosure.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP DISCLOSURE POLICY VERSIONING
// -----------------------------------------------------------------------------
// Alterar o modo incrementa a versão canônica. Assim, um consentimento dado sob
// política anterior nunca volta a produzir exposição automaticamente.
// -----------------------------------------------------------------------------

export type CommunityMembershipDisclosureMode = 'disabled' | 'opt_in';

export interface CommunityMembershipDisclosureTransition {
  readonly currentMode: CommunityMembershipDisclosureMode;
  readonly currentPolicyVersion: number;
  readonly nextMode: CommunityMembershipDisclosureMode;
  readonly nextPolicyVersion: number;
  readonly updated: boolean;
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

export function resolveCommunityMembershipDisclosureTransition(
  rawCommunity: unknown,
  nextMode: CommunityMembershipDisclosureMode
): CommunityMembershipDisclosureTransition {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const disclosure = (community['membershipDisclosure'] ?? {}) as Record<string, unknown>;
  const currentMode: CommunityMembershipDisclosureMode =
    disclosure['profileMembership'] === 'opt_in' ? 'opt_in' : 'disabled';
  const currentPolicyVersion =
    normalizePositiveInteger(disclosure['policyVersion']) ?? 1;
  const updated = currentMode !== nextMode;

  return {
    currentMode,
    currentPolicyVersion,
    nextMode,
    nextPolicyVersion: updated
      ? currentPolicyVersion + 1
      : currentPolicyVersion,
    updated,
  };
}
