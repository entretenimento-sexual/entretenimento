// functions/src/business-official/business-official-entitlement.policy.ts
// -----------------------------------------------------------------------------
// BUSINESS / OFFICIAL ENTITLEMENT
// -----------------------------------------------------------------------------
// Fonte canônica backend-only para direitos efetivos Business/Official.
//
// Separação obrigatória:
// - autoridade/verificação responde quem representa o recurso;
// - community_official_associations responde se a Comunidade é oficial;
// - este entitlement responde o que o sujeito pode consumir/criar.
//
// Preço, plano comercial e dados de checkout não fazem parte deste contrato.
// -----------------------------------------------------------------------------

import {
  OFFICIAL_COMMUNITY_MEMBER_LIMIT,
  normalizeCommunityMemberLimit,
  type CommunityMemberLimit,
} from '../community/community-capacity.policy';
import { COMMUNITY_PRODUCT_LIMITS } from '../community/community-product-limits.config';

export const BUSINESS_OFFICIAL_ENTITLEMENT_SCOPE = 'business_official';
export const BUSINESS_OFFICIAL_ENTITLEMENT_POLICY_VERSION = 1;
export const MAX_BUSINESS_OFFICIAL_CREATIONS =
  COMMUNITY_PRODUCT_LIMITS.officialTechnicalSafety.maxCommunitiesPerGrant;

export type BusinessOfficialEntitlementSubjectType =
  | 'user'
  | 'organization';

export interface BusinessOfficialCreationCapability {
  readonly memberLimit: CommunityMemberLimit;
  readonly maxOwned: number | null;
}

export interface BusinessOfficialCapabilities {
  readonly officialCommunityCreation:
    BusinessOfficialCreationCapability | null;
  readonly officialVenueCreation:
    BusinessOfficialCreationCapability | null;
}

export type BusinessOfficialEntitlementDenialReason =
  | 'entitlement_required'
  | 'entitlement_inactive'
  | 'entitlement_mismatch'
  | null;

export interface BusinessOfficialEntitlementDecision {
  readonly allowed: boolean;
  readonly subjectType: BusinessOfficialEntitlementSubjectType | null;
  readonly subjectId: string | null;
  readonly capabilities: BusinessOfficialCapabilities | null;
  readonly policyVersion: number | null;
  readonly denialReason: BusinessOfficialEntitlementDenialReason;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const FORBIDDEN_OFFER_FIELDS = Object.freeze([
  'amountCents',
  'currency',
  'plan',
  'planId',
  'planKey',
  'price',
  'priceCents',
] as const);

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function normalizeMemberLimit(value: unknown): CommunityMemberLimit | null {
  const limit = normalizeCommunityMemberLimit(value);
  return limit !== null && limit <= OFFICIAL_COMMUNITY_MEMBER_LIMIT
    ? limit
    : null;
}

function normalizeMaxOwned(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= 1
    && value <= MAX_BUSINESS_OFFICIAL_CREATIONS
    ? value
    : undefined;
}

function normalizeCapability(
  raw: unknown
): BusinessOfficialCreationCapability | null | undefined {
  if (raw === null) return null;
  if (!isRecord(raw)) return undefined;

  const memberLimit = normalizeMemberLimit(raw['memberLimit']);
  const maxOwned = normalizeMaxOwned(raw['maxOwned']);
  if (memberLimit === null || maxOwned === undefined) return undefined;

  return Object.freeze({ memberLimit, maxOwned });
}

function normalizeCapabilities(
  raw: unknown
): Readonly<BusinessOfficialCapabilities> | null {
  if (!isRecord(raw)) return null;
  if (
    !Object.hasOwn(raw, 'officialCommunityCreation')
    || !Object.hasOwn(raw, 'officialVenueCreation')
  ) {
    return null;
  }

  const officialCommunityCreation = normalizeCapability(
    raw['officialCommunityCreation']
  );
  const officialVenueCreation = normalizeCapability(
    raw['officialVenueCreation']
  );

  if (
    officialCommunityCreation === undefined
    || officialVenueCreation === undefined
    || (
      officialCommunityCreation === null
      && officialVenueCreation === null
    )
  ) {
    return null;
  }

  return Object.freeze({
    officialCommunityCreation,
    officialVenueCreation,
  });
}

function hasForbiddenOfferFields(
  raw: Readonly<Record<string, unknown>>
): boolean {
  return FORBIDDEN_OFFER_FIELDS.some((field) => Object.hasOwn(raw, field));
}

function denied(input: {
  subjectType: BusinessOfficialEntitlementSubjectType | null;
  subjectId: string | null;
  denialReason: Exclude<BusinessOfficialEntitlementDenialReason, null>;
}): Readonly<BusinessOfficialEntitlementDecision> {
  return Object.freeze({
    allowed: false,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    capabilities: null,
    policyVersion: null,
    denialReason: input.denialReason,
  });
}

export function buildBusinessOfficialEntitlementId(input: {
  readonly subjectType: BusinessOfficialEntitlementSubjectType;
  readonly subjectId: string;
}): string | null {
  const subjectId = cleanId(input.subjectId);
  return subjectId
    ? `business_official:${input.subjectType}:${subjectId}`
    : null;
}

export function evaluateBusinessOfficialEntitlement(input: {
  readonly expectedSubjectType: BusinessOfficialEntitlementSubjectType;
  readonly expectedSubjectId: string;
  readonly rawEntitlement: unknown;
  readonly now?: number;
}): Readonly<BusinessOfficialEntitlementDecision> {
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

  const capabilities = normalizeCapabilities(entitlement['capabilities']);
  if (
    entitlement['scope'] !== BUSINESS_OFFICIAL_ENTITLEMENT_SCOPE
    || entitlement['policyVersion']
      !== BUSINESS_OFFICIAL_ENTITLEMENT_POLICY_VERSION
    || !capabilities
    || hasForbiddenOfferFields(entitlement)
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
    capabilities,
    policyVersion: BUSINESS_OFFICIAL_ENTITLEMENT_POLICY_VERSION,
    denialReason: null,
  });
}

export function buildBusinessOfficialEntitlementDocument(input: {
  readonly subjectType: BusinessOfficialEntitlementSubjectType;
  readonly subjectId: string;
  readonly capabilities: BusinessOfficialCapabilities;
  readonly startsAt: number;
  readonly endsAt: number | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly updatedBy: string;
}): Readonly<Record<string, unknown>> | null {
  const subjectId = cleanId(input.subjectId);
  const updatedBy = cleanId(input.updatedBy);
  const startsAt = finiteEpoch(input.startsAt);
  const endsAt = input.endsAt === null ? null : finiteEpoch(input.endsAt);
  const createdAt = finiteEpoch(input.createdAt);
  const updatedAt = finiteEpoch(input.updatedAt);
  const capabilities = normalizeCapabilities(input.capabilities);

  if (
    !subjectId
    || !updatedBy
    || !capabilities
    || startsAt === null
    || createdAt === null
    || updatedAt === null
    || startsAt <= 0
    || createdAt <= 0
    || updatedAt < createdAt
    || (endsAt !== null && endsAt <= startsAt)
  ) {
    return null;
  }

  return Object.freeze({
    scope: BUSINESS_OFFICIAL_ENTITLEMENT_SCOPE,
    policyVersion: BUSINESS_OFFICIAL_ENTITLEMENT_POLICY_VERSION,
    subjectType: input.subjectType,
    subjectId,
    capabilities,
    active: true,
    startsAt,
    endsAt,
    createdAt,
    updatedAt,
    updatedBy,
  });
}
