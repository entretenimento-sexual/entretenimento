// src/app/community/data-access/community-capacity.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAPACITY - CLIENT CONTRACTS
// -----------------------------------------------------------------------------
// O cliente conhece e valida o contrato de transporte, mas não decide entitlement,
// quota de criação, degraus de capacidade nem qual plano libera cada degrau.
// Essas políticas permanecem autoritativas em
// functions/src/community/community-capacity.policy.ts.
// -----------------------------------------------------------------------------

import type { PlatformSubscriptionRole } from 'src/app/core/services/subscriptions/platform-subscription-access.model';

/**
 * Quantidade recebida do backend. O Angular não mantém uma enumeração comercial
 * local para que novos degraus possam ser introduzidos sem criar segunda fonte.
 */
export type CommunityMemberLimit = number;
export type CommunityEffectiveMemberLimit = number;
export type CommunityCapacitySponsorRole =
  | PlatformSubscriptionRole
  | 'free'
  | 'admin';
export type CommunityMemberLimitRequirement =
  | PlatformSubscriptionRole
  | 'special_access';
export type CommunityRecommendedUpgradeRole = PlatformSubscriptionRole | null;

export interface CommunityMemberLimitCapabilityOption {
  readonly memberLimit: CommunityMemberLimit;
  readonly requirement: CommunityMemberLimitRequirement;
  readonly allowed: boolean;
}

export interface CommunityCapacityPreview {
  configuredLimit: CommunityMemberLimit;
  effectiveLimit: CommunityEffectiveMemberLimit;
  memberCount: number;
  acceptingNewMembers: boolean;
  restrictedByOwnerPlan: boolean;
  memberLimitOptions: readonly CommunityMemberLimitCapabilityOption[];
  /**
   * Compatibilidade de leitura. É sempre derivado de `memberLimitOptions` quando
   * o contrato novo está presente.
   */
  allowedMemberLimits: readonly CommunityMemberLimit[];
}

export type CommunityCreationCapabilityReason =
  | 'subscription_required'
  | 'limit_reached'
  | null;

export interface CommunityCreationCapability {
  canCreate: boolean;
  reason: CommunityCreationCapabilityReason;
  sponsorRole: CommunityCapacitySponsorRole;
  minimumRole: 'basic';
  recommendedUpgradeRole: CommunityRecommendedUpgradeRole;
  currentOwnedCommunities: number;
  maxOwnedCommunities: number | null;
  memberLimit: CommunityEffectiveMemberLimit;
  memberLimitOptions: readonly CommunityMemberLimitCapabilityOption[];
  /**
   * Compatibilidade de leitura para consumidores existentes. É derivado das
   * opções canônicas recebidas e nunca de uma tabela comercial do Angular.
   */
  allowedMemberLimits: readonly CommunityMemberLimit[];
  generatedAt: number;
}

const MAX_TRANSPORT_MEMBER_LIMIT = 1_000_000_000;

export function normalizeCommunityMemberLimit(
  value: unknown
): CommunityMemberLimit | null {
  const parsed = typeof value === 'number' ? value : Number.NaN;

  return Number.isSafeInteger(parsed)
    && parsed > 0
    && parsed <= MAX_TRANSPORT_MEMBER_LIMIT
    ? parsed
    : null;
}

export function communityMemberLimitRequirementLabel(
  requirement: CommunityMemberLimitRequirement
): 'Basic' | 'Premium' | 'VIP' | 'Acesso especial' {
  if (requirement === 'basic') return 'Basic';
  if (requirement === 'premium') return 'Premium';
  if (requirement === 'vip') return 'VIP';
  return 'Acesso especial';
}

export function normalizeCommunityEffectiveMemberLimit(
  value: unknown
): CommunityEffectiveMemberLimit | null {
  return value === 0 ? 0 : normalizeCommunityMemberLimit(value);
}

function normalizeCommunityMemberLimitRequirement(
  value: unknown
): CommunityMemberLimitRequirement | null {
  return value === 'basic'
    || value === 'premium'
    || value === 'vip'
    || value === 'special_access'
    ? value
    : null;
}

function normalizeRecommendedUpgradeRole(
  value: unknown
): CommunityRecommendedUpgradeRole | undefined {
  if (value === null) return null;
  return value === 'basic' || value === 'premium' || value === 'vip'
    ? value
    : undefined;
}

function normalizeCommunityMemberLimitCapabilityOptions(
  raw: unknown,
  allowEmpty = false
): readonly CommunityMemberLimitCapabilityOption[] | null {
  if (!Array.isArray(raw) || (!allowEmpty && raw.length === 0)) return null;

  const byLimit = new Map<number, CommunityMemberLimitCapabilityOption>();

  for (const rawOption of raw) {
    if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) {
      return null;
    }

    const source = rawOption as Record<string, unknown>;
    const memberLimit = normalizeCommunityMemberLimit(source['memberLimit']);
    const requirement = normalizeCommunityMemberLimitRequirement(
      source['requirement']
    );
    const allowed = source['allowed'];

    if (!memberLimit || !requirement || typeof allowed !== 'boolean') {
      return null;
    }

    const existing = byLimit.get(memberLimit);
    if (
      existing
      && (existing.requirement !== requirement || existing.allowed !== allowed)
    ) {
      return null;
    }

    byLimit.set(memberLimit, { memberLimit, requirement, allowed });
  }

  return [...byLimit.values()].sort(
    (left, right) => left.memberLimit - right.memberLimit
  );
}

function normalizeLegacyAllowedMemberLimits(
  raw: unknown
): readonly CommunityMemberLimit[] {
  return Array.isArray(raw)
    ? [...new Set(
      raw
        .map(normalizeCommunityMemberLimit)
        .filter((limit): limit is CommunityMemberLimit => limit !== null)
    )].sort((left, right) => left - right)
    : [];
}

export function normalizeCommunityCapacityPreview(
  raw: unknown
): CommunityCapacityPreview | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const configuredLimit = normalizeCommunityMemberLimit(
    source['configuredLimit']
  );
  const effectiveLimit = normalizeCommunityEffectiveMemberLimit(
    source['effectiveLimit']
  );
  const rawMemberCount = source['memberCount'];
  const memberCount = typeof rawMemberCount === 'number'
    ? rawMemberCount
    : Number.NaN;
  const legacyAllowedMemberLimits = normalizeLegacyAllowedMemberLimits(
    source['allowedMemberLimits']
  );
  const rawMemberLimitOptions = source['memberLimitOptions'];
  const memberLimitOptions = rawMemberLimitOptions === undefined
    ? legacyAllowedMemberLimits.map((memberLimit) => ({
      memberLimit,
      requirement: 'special_access' as const,
      allowed: true,
    }))
    : normalizeCommunityMemberLimitCapabilityOptions(
      rawMemberLimitOptions,
      true
    );

  if (
    !configuredLimit
    || effectiveLimit === null
    || !Number.isInteger(memberCount)
    || memberCount < 0
    || effectiveLimit > configuredLimit
    || !memberLimitOptions
  ) {
    return null;
  }

  const allowedMemberLimits = memberLimitOptions
    .filter((option) => option.allowed)
    .map((option) => option.memberLimit);

  return {
    configuredLimit,
    effectiveLimit,
    memberCount,
    acceptingNewMembers:
      source['acceptingNewMembers'] === true && memberCount < effectiveLimit,
    restrictedByOwnerPlan: configuredLimit > effectiveLimit,
    memberLimitOptions,
    allowedMemberLimits,
  };
}

export function normalizeCommunityCreationCapability(
  raw: unknown
): CommunityCreationCapability | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const sponsorRole = source['sponsorRole'];
  const reason = source['reason'];
  const memberLimit = normalizeCommunityEffectiveMemberLimit(
    source['memberLimit']
  );
  const recommendedUpgradeRole = normalizeRecommendedUpgradeRole(
    source['recommendedUpgradeRole']
  );
  const currentOwnedCommunities = Number(source['currentOwnedCommunities']);
  const rawMaximum = source['maxOwnedCommunities'];
  const maxOwnedCommunities = rawMaximum === null
    ? null
    : Number(rawMaximum);
  const generatedAt = Number(source['generatedAt']);
  const memberLimitOptions = normalizeCommunityMemberLimitCapabilityOptions(
    source['memberLimitOptions']
  );

  if (
    (sponsorRole !== 'free'
      && sponsorRole !== 'basic'
      && sponsorRole !== 'premium'
      && sponsorRole !== 'vip'
      && sponsorRole !== 'admin')
    || (reason !== null
      && reason !== 'subscription_required'
      && reason !== 'limit_reached')
    || source['minimumRole'] !== 'basic'
    || memberLimit === null
    || recommendedUpgradeRole === undefined
    || !Number.isInteger(currentOwnedCommunities)
    || currentOwnedCommunities < 0
    || (maxOwnedCommunities !== null
      && (!Number.isInteger(maxOwnedCommunities) || maxOwnedCommunities < 0))
    || !Number.isFinite(generatedAt)
    || !memberLimitOptions
  ) {
    return null;
  }

  const canCreate = source['canCreate'] === true;
  if (canCreate !== (reason === null)) return null;
  if (reason === null && recommendedUpgradeRole !== null) return null;
  if (reason === 'subscription_required' && recommendedUpgradeRole === null) {
    return null;
  }

  const allowedMemberLimits = memberLimitOptions
    .filter((option) => option.allowed)
    .map((option) => option.memberLimit);

  if (allowedMemberLimits.some((limit) => limit > memberLimit)) return null;
  if (canCreate && allowedMemberLimits.length === 0) return null;

  return {
    canCreate,
    reason,
    sponsorRole,
    minimumRole: 'basic',
    recommendedUpgradeRole,
    currentOwnedCommunities,
    maxOwnedCommunities,
    memberLimit,
    memberLimitOptions,
    allowedMemberLimits,
    generatedAt,
  };
}
