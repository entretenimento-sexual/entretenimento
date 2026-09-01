// functions/src/community/community-capacity.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAPACITY POLICY
// -----------------------------------------------------------------------------
// A assinatura do proprietário define somente o teto de crescimento. O limite
// escolhido pertence à Comunidade e nunca remove memberships existentes.
//
// Esta policy também é a fonte canônica das opções comerciais expostas ao
// compositor. O cliente recebe capacidade, requisito e recomendação já resolvidos
// e nunca deve reconstruir a relação entre quantidade de membros e plano.
// -----------------------------------------------------------------------------

import { normalizeCommunityMemberCount } from './community-member-count.policy';

export const COMMUNITY_MEMBER_LIMIT_OPTIONS = [
  25,
  50,
  100,
  250,
  500,
  1_000,
] as const;

export type CommunityMemberLimit =
  typeof COMMUNITY_MEMBER_LIMIT_OPTIONS[number];
export type CommunityEffectiveMemberLimit = 0 | CommunityMemberLimit;
export type CommunityCapacitySponsorRole =
  | 'free'
  | 'basic'
  | 'premium'
  | 'vip'
  | 'official_space'
  | 'admin';
export type PersonalCommunitySponsorRole = Exclude<
  CommunityCapacitySponsorRole,
  'official_space'
>;
export type CommunityPaidSubscriptionRole = 'basic' | 'premium' | 'vip';
export type CommunityMemberLimitRequirement =
  | CommunityPaidSubscriptionRole
  | 'special_access';
export type CommunityRecommendedUpgradeRole =
  | CommunityPaidSubscriptionRole
  | null;

export interface PersonalCommunityCreationPolicy {
  canCreate: boolean;
  maxOwnedCommunities: number | null;
  memberLimit: CommunityEffectiveMemberLimit;
}

export interface CommunityMemberLimitCapabilityOption {
  readonly memberLimit: CommunityMemberLimit;
  readonly requirement: CommunityMemberLimitRequirement;
  readonly allowed: boolean;
}

export type CommunityCreationCapabilityReason =
  | 'subscription_required'
  | 'limit_reached'
  | null;

export interface CommunityCreationCapability {
  canCreate: boolean;
  reason: CommunityCreationCapabilityReason;
  sponsorRole: PersonalCommunitySponsorRole;
  minimumRole: 'basic';
  recommendedUpgradeRole: CommunityRecommendedUpgradeRole;
  currentOwnedCommunities: number;
  maxOwnedCommunities: number | null;
  memberLimit: CommunityEffectiveMemberLimit;
  memberLimitOptions: readonly CommunityMemberLimitCapabilityOption[];
  /**
   * Compatibilidade temporária para consumidores já existentes. Novas UIs devem
   * usar `memberLimitOptions`, que transporta também requisito e disponibilidade.
   */
  allowedMemberLimits: readonly CommunityMemberLimit[];
}

export interface CommunityCapacityState {
  configuredLimit: CommunityMemberLimit;
  ownerPlanLimit: CommunityEffectiveMemberLimit;
  effectiveLimit: CommunityEffectiveMemberLimit;
  memberCount: number | null;
  acceptingNewMembers: boolean;
  restrictedByOwnerPlan: boolean;
  atCapacity: boolean;
}

const DEFAULT_COMMUNITY_MEMBER_LIMIT: CommunityMemberLimit = 25;
export const OFFICIAL_SPACE_MEMBER_LIMIT: CommunityMemberLimit = 1_000;
export const MAX_PERSONAL_COMMUNITIES_PER_OWNER = 5;

const ROLE_MEMBER_LIMIT: Readonly<
  Record<CommunityCapacitySponsorRole, CommunityEffectiveMemberLimit>
> = Object.freeze({
  free: 0,
  basic: 100,
  premium: 250,
  vip: 500,
  official_space: OFFICIAL_SPACE_MEMBER_LIMIT,
  admin: 1_000,
});

const PERSONAL_CREATION_LIMIT: Readonly<
  Record<PersonalCommunitySponsorRole, number | null>
> = Object.freeze({
  free: 0,
  basic: 1,
  premium: 3,
  vip: 5,
  admin: null,
});

const PUBLIC_SUBSCRIPTION_ROLE_ORDER = Object.freeze([
  'basic',
  'premium',
  'vip',
] as const);

const PERSONAL_COMMUNITY_UPGRADE_ROLE: Readonly<
  Record<PersonalCommunitySponsorRole, CommunityRecommendedUpgradeRole>
> = Object.freeze({
  free: 'basic',
  basic: 'premium',
  premium: 'vip',
  vip: null,
  admin: null,
});

export function normalizeCommunityMemberLimit(
  value: unknown
): CommunityMemberLimit | null {
  return COMMUNITY_MEMBER_LIMIT_OPTIONS.includes(
    value as CommunityMemberLimit
  )
    ? value as CommunityMemberLimit
    : null;
}

export function resolveCommunityConfiguredMemberLimit(
  rawCommunity: unknown
): CommunityMemberLimit {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const capacity = (community['capacity'] ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;

  return normalizeCommunityMemberLimit(capacity['memberLimit'])
    ?? (source['type'] === 'venue'
      ? OFFICIAL_SPACE_MEMBER_LIMIT
      : DEFAULT_COMMUNITY_MEMBER_LIMIT);
}

export function resolveCommunityCapacitySponsorRole(
  activeSubscriptionRole: unknown,
  ownerUserRole: unknown
): PersonalCommunitySponsorRole {
  if (ownerUserRole === 'admin') return 'admin';
  return activeSubscriptionRole === 'basic'
    || activeSubscriptionRole === 'premium'
    || activeSubscriptionRole === 'vip'
    ? activeSubscriptionRole
    : 'free';
}

export function resolveCommunityOwnerPlanLimit(
  role: CommunityCapacitySponsorRole
): CommunityEffectiveMemberLimit {
  return ROLE_MEMBER_LIMIT[role];
}

export function resolveCommunityMemberLimitOptions(
  role: CommunityCapacitySponsorRole
): readonly CommunityMemberLimit[] {
  const ceiling = resolveCommunityOwnerPlanLimit(role);
  return COMMUNITY_MEMBER_LIMIT_OPTIONS.filter((limit) => limit <= ceiling);
}

export function isCommunityMemberLimitAllowed(
  memberLimit: CommunityMemberLimit,
  role: CommunityCapacitySponsorRole
): boolean {
  return memberLimit <= resolveCommunityOwnerPlanLimit(role);
}

export function resolveCommunityMemberLimitRequirement(
  memberLimit: CommunityMemberLimit
): CommunityMemberLimitRequirement {
  const minimumSubscriptionRole = PUBLIC_SUBSCRIPTION_ROLE_ORDER.find(
    (role) => memberLimit <= resolveCommunityOwnerPlanLimit(role)
  );

  return minimumSubscriptionRole ?? 'special_access';
}

export function resolveCommunityMemberLimitCapabilityOptions(
  role: CommunityCapacitySponsorRole
): readonly CommunityMemberLimitCapabilityOption[] {
  return COMMUNITY_MEMBER_LIMIT_OPTIONS.map((memberLimit) => ({
    memberLimit,
    requirement: resolveCommunityMemberLimitRequirement(memberLimit),
    allowed: isCommunityMemberLimitAllowed(memberLimit, role),
  }));
}

export function resolveRecommendedCommunityUpgradeRole(
  role: PersonalCommunitySponsorRole
): CommunityRecommendedUpgradeRole {
  return PERSONAL_COMMUNITY_UPGRADE_ROLE[role];
}

export function resolvePersonalCommunityCreationPolicy(
  role: PersonalCommunitySponsorRole
): Readonly<PersonalCommunityCreationPolicy> {
  return {
    canCreate: role !== 'free',
    maxOwnedCommunities: PERSONAL_CREATION_LIMIT[role],
    memberLimit: resolveCommunityOwnerPlanLimit(role),
  };
}

export function resolveCommunityCreationCapability(input: {
  sponsorRole: PersonalCommunitySponsorRole;
  currentOwnedCommunities: number;
}): Readonly<CommunityCreationCapability> {
  const currentOwnedCommunities = Number.isFinite(input.currentOwnedCommunities)
    ? Math.max(Math.trunc(input.currentOwnedCommunities), 0)
    : 0;
  const creationPolicy = resolvePersonalCommunityCreationPolicy(
    input.sponsorRole
  );
  const subscriptionRequired = !creationPolicy.canCreate;
  const limitReached =
    creationPolicy.maxOwnedCommunities !== null
    && currentOwnedCommunities >= creationPolicy.maxOwnedCommunities;
  const reason: CommunityCreationCapabilityReason = subscriptionRequired
    ? 'subscription_required'
    : limitReached
      ? 'limit_reached'
      : null;

  return {
    canCreate: reason === null,
    reason,
    sponsorRole: input.sponsorRole,
    minimumRole: 'basic',
    recommendedUpgradeRole: reason === null
      ? null
      : resolveRecommendedCommunityUpgradeRole(input.sponsorRole),
    currentOwnedCommunities,
    maxOwnedCommunities: creationPolicy.maxOwnedCommunities,
    memberLimit: creationPolicy.memberLimit,
    memberLimitOptions: resolveCommunityMemberLimitCapabilityOptions(
      input.sponsorRole
    ),
    allowedMemberLimits: resolveCommunityMemberLimitOptions(input.sponsorRole),
  };
}

export function evaluateCommunityCapacity(input: {
  rawCommunity: unknown;
  sponsorRole: CommunityCapacitySponsorRole;
}): Readonly<CommunityCapacityState> {
  const community = (input.rawCommunity ?? {}) as Record<string, unknown>;
  const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;
  const configuredLimit = resolveCommunityConfiguredMemberLimit(community);
  const ownerPlanLimit = resolveCommunityOwnerPlanLimit(input.sponsorRole);
  const effectiveLimit = Math.min(
    configuredLimit,
    ownerPlanLimit
  ) as CommunityEffectiveMemberLimit;
  const memberCount = normalizeCommunityMemberCount(metrics['memberCount']);
  const acceptingNewMembers =
    memberCount !== null && memberCount < effectiveLimit;

  return {
    configuredLimit,
    ownerPlanLimit,
    effectiveLimit,
    memberCount,
    acceptingNewMembers,
    restrictedByOwnerPlan: configuredLimit > ownerPlanLimit,
    atCapacity: !acceptingNewMembers,
  };
}
