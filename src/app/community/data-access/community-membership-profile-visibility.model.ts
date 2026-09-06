// src/app/community/data-access/community-membership-profile-visibility.model.ts
// -----------------------------------------------------------------------------
// PRIVATE COMMUNITY MEMBERSHIP VISIBILITY CONTRACTS
// -----------------------------------------------------------------------------

export type CommunityMembershipProfileVisibility = 'hidden' | 'visible';
export type CommunityMembershipDisclosureMode = 'disabled' | 'opt_in';

export interface CommunityMembershipProfileVisibilityState {
  readonly communityId: string;
  readonly disclosureMode: CommunityMembershipDisclosureMode;
  readonly policyVersion: number;
  readonly profileVisibility: CommunityMembershipProfileVisibility;
  readonly profileVisibilityPolicyVersion: number | null;
  readonly canChange: boolean;
  readonly canManagePolicy: boolean;
  readonly generatedAt: number;
}

export interface CommunityMembershipDisclosureUpdateResult {
  readonly communityId: string;
  readonly mode: CommunityMembershipDisclosureMode;
  readonly policyVersion: number;
  readonly updated: boolean;
  readonly generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizePositiveInteger(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : null;
}

export function normalizeCommunityMembershipProfileVisibilityState(
  raw: unknown
): CommunityMembershipProfileVisibilityState | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeText(source['communityId'], 128);
  const disclosureMode = source['disclosureMode'];
  const policyVersion = normalizePositiveInteger(source['policyVersion']);
  const profileVisibility = source['profileVisibility'];
  const acceptedPolicyVersion = source['profileVisibilityPolicyVersion'] == null
    ? null
    : normalizePositiveInteger(source['profileVisibilityPolicyVersion']);
  const generatedAt = Number(source['generatedAt']);

  if (
    !SAFE_ID_PATTERN.test(communityId)
    || (disclosureMode !== 'disabled' && disclosureMode !== 'opt_in')
    || !policyVersion
    || (profileVisibility !== 'hidden' && profileVisibility !== 'visible')
    || (profileVisibility === 'visible' && acceptedPolicyVersion !== policyVersion)
    || !Number.isFinite(generatedAt)
  ) {
    return null;
  }

  return {
    communityId,
    disclosureMode,
    policyVersion,
    profileVisibility,
    profileVisibilityPolicyVersion:
      profileVisibility === 'visible' ? acceptedPolicyVersion : null,
    canChange: source['canChange'] === true,
    canManagePolicy: source['canManagePolicy'] === true,
    generatedAt,
  };
}

export function normalizeCommunityMembershipDisclosureUpdateResult(
  raw: unknown
): CommunityMembershipDisclosureUpdateResult | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const communityId = normalizeText(source['communityId'], 128);
  const mode = source['mode'];
  const policyVersion = normalizePositiveInteger(source['policyVersion']);
  const generatedAt = Number(source['generatedAt']);

  if (
    !SAFE_ID_PATTERN.test(communityId)
    || (mode !== 'disabled' && mode !== 'opt_in')
    || !policyVersion
    || !Number.isFinite(generatedAt)
  ) {
    return null;
  }

  return {
    communityId,
    mode,
    policyVersion,
    updated: source['updated'] === true,
    generatedAt,
  };
}
