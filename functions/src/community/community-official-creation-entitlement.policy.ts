// functions/src/community/community-official-creation-entitlement.policy.ts
// -----------------------------------------------------------------------------
// OFFICIAL COMMUNITY CREATION ENTITLEMENT
// -----------------------------------------------------------------------------
// Autoridade sobre o alvo oficial e capacidade comercial são fronteiras
// independentes. Esta policy aceita somente uma capacidade explicitamente
// concedida pelo backend; hard ceilings técnicos servem apenas para validar o
// grant e nunca são promovidos a oferta implícita.
// -----------------------------------------------------------------------------

import {
  OFFICIAL_COMMUNITY_MEMBER_LIMIT,
  normalizeCommunityMemberLimit,
  type CommunityMemberLimit,
} from './community-capacity.policy';
import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';

export const OFFICIAL_COMMUNITY_CREATION_ENTITLEMENT_POLICY_VERSION = 1;
export const MAX_OFFICIAL_COMMUNITIES_PER_ENTITLEMENT =
  COMMUNITY_PRODUCT_LIMITS.officialTechnicalSafety.maxCommunitiesPerGrant;

export type OfficialCommunityCreationEntitlementSubjectType =
  | 'user'
  | 'organization';

export type OfficialCommunityCreationEntitlementDenialReason =
  | 'entitlement_required'
  | 'entitlement_inactive'
  | 'entitlement_mismatch'
  | null;

export interface OfficialCommunityCreationCapability {
  readonly allowed: boolean;
  readonly subjectType: OfficialCommunityCreationEntitlementSubjectType | null;
  readonly subjectId: string | null;
  readonly memberLimit: CommunityMemberLimit | null;
  /**
   * null é uma decisão explícita do produto: não há quota de quantidade.
   * Ausência/malformação do campo é rejeitada, portanto nunca vira ilimitado.
   */
  readonly maxOfficialCommunities: number | null;
  readonly policyVersion: number | null;
  readonly denialReason: OfficialCommunityCreationEntitlementDenialReason;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeGrantedMemberLimit(value: unknown): CommunityMemberLimit | null {
  const memberLimit = normalizeCommunityMemberLimit(value);
  return memberLimit !== null && memberLimit <= OFFICIAL_COMMUNITY_MEMBER_LIMIT
    ? memberLimit
    : null;
}

function normalizeQuantityQuota(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_OFFICIAL_COMMUNITIES_PER_ENTITLEMENT
    ? value
    : undefined;
}

function finiteEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function denied(input: {
  readonly subjectType:
    OfficialCommunityCreationEntitlementSubjectType | null;
  readonly subjectId: string | null;
  readonly denialReason: Exclude<
    OfficialCommunityCreationEntitlementDenialReason,
    null
  >;
}): Readonly<OfficialCommunityCreationCapability> {
  return Object.freeze({
    allowed: false,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    memberLimit: null,
    maxOfficialCommunities: null,
    policyVersion: null,
    denialReason: input.denialReason,
  });
}

export function evaluateOfficialCommunityCreationEntitlement(input: {
  readonly expectedSubjectType: OfficialCommunityCreationEntitlementSubjectType;
  readonly expectedSubjectId: string;
  readonly rawEntitlement: unknown;
  readonly now?: number;
}): Readonly<OfficialCommunityCreationCapability> {
  const expectedSubjectId = cleanId(input.expectedSubjectId);
  if (!expectedSubjectId) {
    return denied({
      subjectType: input.expectedSubjectType,
      subjectId: null,
      denialReason: 'entitlement_mismatch',
    });
  }

  if (!isRecord(input.rawEntitlement)) {
    return denied({
      subjectType: input.expectedSubjectType,
      subjectId: expectedSubjectId,
      denialReason: 'entitlement_required',
    });
  }

  const entitlement = input.rawEntitlement;
  const subjectType = entitlement['subjectType'];
  const subjectId = cleanId(entitlement['subjectId']);
  if (
    subjectType !== input.expectedSubjectType
    || subjectId !== expectedSubjectId
  ) {
    return denied({
      subjectType: input.expectedSubjectType,
      subjectId: expectedSubjectId,
      denialReason: 'entitlement_mismatch',
    });
  }

  const memberLimit = normalizeGrantedMemberLimit(entitlement['memberLimit']);
  const maxOfficialCommunities = normalizeQuantityQuota(
    entitlement['maxOfficialCommunities']
  );
  if (
    entitlement['scope'] !== 'official_community_creation'
    || entitlement['policyVersion']
      !== OFFICIAL_COMMUNITY_CREATION_ENTITLEMENT_POLICY_VERSION
    || memberLimit === null
    || maxOfficialCommunities === undefined
  ) {
    return denied({
      subjectType: input.expectedSubjectType,
      subjectId: expectedSubjectId,
      denialReason: 'entitlement_required',
    });
  }

  const now = Math.trunc(input.now ?? Date.now());
  const startsAt = finiteEpoch(entitlement['startsAt']);
  const rawEndsAt = entitlement['endsAt'];
  const endsAt = rawEndsAt === null ? null : finiteEpoch(rawEndsAt);
  const activeWindow =
    Number.isFinite(now)
    && now > 0
    && startsAt !== null
    && startsAt <= now
    && (rawEndsAt === null || (endsAt !== null && endsAt > now));

  if (entitlement['active'] !== true || !activeWindow) {
    return denied({
      subjectType: input.expectedSubjectType,
      subjectId: expectedSubjectId,
      denialReason: 'entitlement_inactive',
    });
  }

  return Object.freeze({
    allowed: true,
    subjectType: input.expectedSubjectType,
    subjectId: expectedSubjectId,
    memberLimit,
    maxOfficialCommunities,
    policyVersion: OFFICIAL_COMMUNITY_CREATION_ENTITLEMENT_POLICY_VERSION,
    denialReason: null,
  });
}
