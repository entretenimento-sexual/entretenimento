// src/app/community/data-access/community-capacity.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAPACITY - CLIENT CONTRACTS
// -----------------------------------------------------------------------------
// O cliente conhece o contrato e normaliza respostas, mas não decide entitlement,
// quota de criação nem teto por plano. Essas políticas permanecem autoritativas
// em functions/src/community/community-capacity.policy.ts.
// -----------------------------------------------------------------------------

import type { PlatformSubscriptionRole } from 'src/app/core/services/subscriptions/platform-subscription-access.model';

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
  | PlatformSubscriptionRole
  | 'free'
  | 'admin';

export interface CommunityCapacityPreview {
  configuredLimit: CommunityMemberLimit;
  effectiveLimit: CommunityEffectiveMemberLimit;
  memberCount: number;
  acceptingNewMembers: boolean;
  restrictedByOwnerPlan: boolean;
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
  currentOwnedCommunities: number;
  maxOwnedCommunities: number | null;
  memberLimit: CommunityEffectiveMemberLimit;
  allowedMemberLimits: readonly CommunityMemberLimit[];
  generatedAt: number;
}

export function normalizeCommunityMemberLimit(
  value: unknown
): CommunityMemberLimit | null {
  return COMMUNITY_MEMBER_LIMIT_OPTIONS.includes(
    value as CommunityMemberLimit
  )
    ? value as CommunityMemberLimit
    : null;
}

/**
 * Rótulo exclusivamente de apresentação. Não concede acesso e não substitui a
 * capability retornada pelo backend; a validação efetiva sempre ocorre na Function.
 */
export function communityMemberLimitRequiredRole(
  limit: CommunityMemberLimit
): 'Basic' | 'Premium' | 'VIP' | 'Comercial' {
  if (limit <= 100) return 'Basic';
  if (limit <= 250) return 'Premium';
  if (limit <= 500) return 'VIP';
  return 'Comercial';
}

export function normalizeCommunityEffectiveMemberLimit(
  value: unknown
): CommunityEffectiveMemberLimit | null {
  return value === 0 ? 0 : normalizeCommunityMemberLimit(value);
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
  const allowedMemberLimits = Array.isArray(source['allowedMemberLimits'])
    ? source['allowedMemberLimits']
      .map(normalizeCommunityMemberLimit)
      .filter((limit): limit is CommunityMemberLimit => limit !== null)
    : [];

  if (
    !configuredLimit
    || effectiveLimit === null
    || !Number.isInteger(memberCount)
    || memberCount < 0
    || effectiveLimit > configuredLimit
  ) {
    return null;
  }

  return {
    configuredLimit,
    effectiveLimit,
    memberCount,
    acceptingNewMembers:
      source['acceptingNewMembers'] === true && memberCount < effectiveLimit,
    restrictedByOwnerPlan: configuredLimit > effectiveLimit,
    allowedMemberLimits: [...new Set(allowedMemberLimits)],
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
  const currentOwnedCommunities = Number(source['currentOwnedCommunities']);
  const rawMaximum = source['maxOwnedCommunities'];
  const maxOwnedCommunities = rawMaximum === null
    ? null
    : Number(rawMaximum);
  const generatedAt = Number(source['generatedAt']);
  const allowedMemberLimits = Array.isArray(source['allowedMemberLimits'])
    ? source['allowedMemberLimits']
      .map(normalizeCommunityMemberLimit)
      .filter((limit): limit is CommunityMemberLimit => limit !== null)
    : null;

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
    || !Number.isInteger(currentOwnedCommunities)
    || currentOwnedCommunities < 0
    || (maxOwnedCommunities !== null
      && (!Number.isInteger(maxOwnedCommunities) || maxOwnedCommunities < 0))
    || !Number.isFinite(generatedAt)
    || !allowedMemberLimits
  ) {
    return null;
  }

  const canCreate = source['canCreate'] === true;
  if (canCreate !== (reason === null)) return null;

  return {
    canCreate,
    reason,
    sponsorRole,
    minimumRole: 'basic',
    currentOwnedCommunities,
    maxOwnedCommunities,
    memberLimit,
    allowedMemberLimits: [...new Set(allowedMemberLimits)]
      .filter((limit) => limit <= memberLimit),
    generatedAt,
  };
}
