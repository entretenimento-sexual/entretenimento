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
    | 'consent_policy_mismatch'
    | 'consent_predates_membership_cycle';
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

function normalizeTimestampMs(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }

  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof source.toMillis === 'function') {
      const time = Number(source.toMillis());
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }

    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const time = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }
  }

  return null;
}

export function isCommunityMembershipProfileVisibilityConsentCurrent(
  rawMembership: unknown
): boolean {
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const joinedAt = normalizeTimestampMs(membership['joinedAt']);
  if (joinedAt === null) return true;

  const profileVisibilityUpdatedAt = normalizeTimestampMs(
    membership['profileVisibilityUpdatedAt']
  );
  return profileVisibilityUpdatedAt !== null
    && profileVisibilityUpdatedAt >= joinedAt;
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

  if (!isCommunityMembershipProfileVisibilityConsentCurrent(membership)) {
    return { visible: false, reason: 'consent_predates_membership_cycle' };
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
        profileVisibilityUpdatedAt:
          membership['joinedAt'] ?? membership['profileVisibilityUpdatedAt'],
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
