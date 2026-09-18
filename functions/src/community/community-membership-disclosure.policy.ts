// functions/src/community/community-membership-disclosure.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP DISCLOSURE POLICY VERSIONING
// -----------------------------------------------------------------------------
// Alterar o modo incrementa a versão canônica. Assim, um consentimento dado sob
// política anterior nunca volta a produzir exposição automaticamente.
// -----------------------------------------------------------------------------

export type CommunityMembershipDisclosureMode = 'disabled' | 'opt_in';

export type CommunityMembershipDisclosureState =
  | Readonly<{
    kind: 'legacy_absent';
    mode: 'disabled';
    policyVersion: 1;
  }>
  | Readonly<{
    kind: 'valid';
    mode: CommunityMembershipDisclosureMode;
    policyVersion: number;
  }>
  | Readonly<{ kind: 'invalid' }>;

export interface CommunityMembershipDisclosureTransition {
  readonly currentMode: CommunityMembershipDisclosureMode;
  readonly currentPolicyVersion: number;
  readonly nextMode: CommunityMembershipDisclosureMode;
  readonly nextPolicyVersion: number;
  readonly updated: boolean;
}

function normalizePositiveInteger(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    ? value
    : null;
}

export function classifyCommunityMembershipDisclosureState(
  rawCommunity: unknown
): CommunityMembershipDisclosureState {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;

  if (
    !Object.prototype.hasOwnProperty.call(
      community,
      'membershipDisclosure'
    )
  ) {
    return {
      kind: 'legacy_absent',
      mode: 'disabled',
      policyVersion: 1,
    };
  }

  const rawDisclosure = community['membershipDisclosure'];

  if (
    rawDisclosure === null
    || typeof rawDisclosure !== 'object'
    || Array.isArray(rawDisclosure)
  ) {
    return { kind: 'invalid' };
  }

  const disclosure = rawDisclosure as Record<string, unknown>;
  const mode = disclosure['profileMembership'];
  const policyVersion = normalizePositiveInteger(disclosure['policyVersion']);

  if (
    (mode !== 'disabled' && mode !== 'opt_in')
    || policyVersion === null
  ) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'valid',
    mode,
    policyVersion,
  };
}

export function resolveCommunityMembershipDisclosureTransition(
  rawCommunity: unknown,
  nextMode: CommunityMembershipDisclosureMode
): CommunityMembershipDisclosureTransition | null {
  const state = classifyCommunityMembershipDisclosureState(rawCommunity);
  if (state.kind === 'invalid') return null;

  const currentMode = state.mode;
  const currentPolicyVersion = state.policyVersion;
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
