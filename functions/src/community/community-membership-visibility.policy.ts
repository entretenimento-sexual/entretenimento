// functions/src/community/community-membership-visibility.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP VISIBILITY POLICY
// -----------------------------------------------------------------------------
// Decide elegibilidade para exposição pública da participação. O locator privado
// nunca concede acesso. Toda ausência, valor desconhecido ou versão divergente
// falha fechado.
// -----------------------------------------------------------------------------

export interface CommunityMembershipVisibilityDecision {
  readonly visible: boolean;
  readonly reason:
    | 'eligible'
    | 'community_not_public'
    | 'community_not_active'
    | 'community_not_moderation_active'
    | 'community_disclosure_disabled'
    | 'community_disclosure_policy_invalid'
    | 'membership_not_active'
    | 'member_not_opted_in'
    | 'consent_policy_mismatch';
}

export interface CommunityMembershipProfileVisibilityResolvedState {
  readonly disclosureMode: 'disabled' | 'opt_in';
  readonly policyVersion: number;
  readonly profileVisibility: 'hidden' | 'visible';
  readonly profileVisibilityPolicyVersion: number | null;
  readonly canChange: boolean;
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

export function resolveCommunityMembershipVisibility(
  rawCommunity: unknown,
  rawMembership: unknown
): CommunityMembershipVisibilityDecision {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
  const disclosure = (community['membershipDisclosure'] ?? {}) as Record<string, unknown>;

  if (community['visibility'] !== 'public_preview') {
    return { visible: false, reason: 'community_not_public' };
  }

  if (community['status'] !== 'active') {
    return { visible: false, reason: 'community_not_active' };
  }

  if (moderation['state'] !== 'active') {
    return { visible: false, reason: 'community_not_moderation_active' };
  }

  if (disclosure['profileMembership'] !== 'opt_in') {
    return { visible: false, reason: 'community_disclosure_disabled' };
  }

  const policyVersion = normalizePositiveInteger(disclosure['policyVersion']);
  if (!policyVersion) {
    return { visible: false, reason: 'community_disclosure_policy_invalid' };
  }

  if (membership['status'] !== 'active') {
    return { visible: false, reason: 'membership_not_active' };
  }

  if (membership['profileVisibility'] !== 'visible') {
    return { visible: false, reason: 'member_not_opted_in' };
  }

  const consentPolicyVersion = normalizePositiveInteger(
    membership['profileVisibilityPolicyVersion']
  );
  if (consentPolicyVersion !== policyVersion) {
    return { visible: false, reason: 'consent_policy_mismatch' };
  }

  return { visible: true, reason: 'eligible' };
}

export function resolveCommunityMembershipProfileVisibilityState(
  rawCommunity: unknown,
  rawMembership: unknown
): CommunityMembershipProfileVisibilityResolvedState {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const disclosure = (community['membershipDisclosure'] ?? {}) as Record<string, unknown>;
  const policyVersion = normalizePositiveInteger(disclosure['policyVersion']);
  const disclosureEnabled =
    disclosure['profileMembership'] === 'opt_in' && policyVersion !== null;
  const currentDecision = resolveCommunityMembershipVisibility(
    community,
    membership
  );
  const acceptedPolicyVersion = normalizePositiveInteger(
    membership['profileVisibilityPolicyVersion']
  );
  const canChange = disclosureEnabled
    && resolveCommunityMembershipVisibility(
      community,
      {
        ...membership,
        profileVisibility: 'visible',
        profileVisibilityPolicyVersion: policyVersion,
      }
    ).visible;

  return {
    disclosureMode: disclosureEnabled ? 'opt_in' : 'disabled',
    policyVersion: policyVersion ?? 1,
    profileVisibility: currentDecision.visible ? 'visible' : 'hidden',
    profileVisibilityPolicyVersion: currentDecision.visible
      ? acceptedPolicyVersion
      : null,
    canChange,
  };
}
