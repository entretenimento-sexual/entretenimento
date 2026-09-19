// functions/src/community/community-membership-visibility.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP VISIBILITY POLICY
// -----------------------------------------------------------------------------
// Decide elegibilidade para exposição pública da participação. O locator privado
// nunca concede acesso. Toda ausência, valor desconhecido ou versão divergente
// falha fechado.
// -----------------------------------------------------------------------------

import {
  classifyCommunityMembershipDisclosureState,
} from './community-membership-disclosure.policy';

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

export type CommunityMembershipProfileVisibilityPersistenceState =
  | { readonly kind: 'legacy_hidden' }
  | { readonly kind: 'hidden' }
  | { readonly kind: 'visible'; readonly policyVersion: number }
  | { readonly kind: 'invalid' };

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    ? value
    : null;
}

export function classifyCommunityMembershipProfileVisibilityState(
  rawMembership: unknown
): CommunityMembershipProfileVisibilityPersistenceState {
  if (
    rawMembership === null
    || typeof rawMembership !== 'object'
    || Array.isArray(rawMembership)
  ) {
    return { kind: 'invalid' };
  }

  const membership = rawMembership as Record<string, unknown>;
  const hasVisibility = Object.prototype.hasOwnProperty.call(
    membership,
    'profileVisibility'
  );
  const hasPolicyVersion = Object.prototype.hasOwnProperty.call(
    membership,
    'profileVisibilityPolicyVersion'
  );

  if (!hasVisibility && !hasPolicyVersion) {
    return { kind: 'legacy_hidden' };
  }

  const visibility = membership['profileVisibility'];
  const rawPolicyVersion = membership['profileVisibilityPolicyVersion'];

  if (
    visibility === 'hidden'
    && (!hasPolicyVersion || rawPolicyVersion === null)
  ) {
    return { kind: 'hidden' };
  }

  const policyVersion = normalizePositiveInteger(rawPolicyVersion);
  if (visibility === 'visible' && policyVersion !== null) {
    return { kind: 'visible', policyVersion };
  }

  return { kind: 'invalid' };
}

export function resolveCommunityMembershipVisibility(
  rawCommunity: unknown,
  rawMembership: unknown
): CommunityMembershipVisibilityDecision {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;

  if (community['visibility'] !== 'public_preview') {
    return { visible: false, reason: 'community_not_public' };
  }

  if (community['status'] !== 'active') {
    return { visible: false, reason: 'community_not_active' };
  }

  if (moderation['state'] !== 'active') {
    return { visible: false, reason: 'community_not_moderation_active' };
  }

  const disclosureState =
    classifyCommunityMembershipDisclosureState(community);

  if (disclosureState.kind === 'invalid') {
    return { visible: false, reason: 'community_disclosure_policy_invalid' };
  }

  if (disclosureState.mode !== 'opt_in') {
    return { visible: false, reason: 'community_disclosure_disabled' };
  }

  const policyVersion = disclosureState.policyVersion;

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
  const disclosureState =
    classifyCommunityMembershipDisclosureState(community);
  const disclosureEnabled =
    disclosureState.kind !== 'invalid'
    && disclosureState.mode === 'opt_in';
  const policyVersion = disclosureState.kind === 'invalid'
    ? 1
    : disclosureState.policyVersion;
  const currentDecision = resolveCommunityMembershipVisibility(
    community,
    membership
  );
  const persistedVisibilityState =
    classifyCommunityMembershipProfileVisibilityState(membership);
  const acceptedPolicyVersion = normalizePositiveInteger(
    membership['profileVisibilityPolicyVersion']
  );
  const canChange = disclosureEnabled
    && persistedVisibilityState.kind !== 'invalid'
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
    policyVersion,
    profileVisibility: currentDecision.visible ? 'visible' : 'hidden',
    profileVisibilityPolicyVersion: currentDecision.visible
      ? acceptedPolicyVersion
      : null,
    canChange,
  };
}
