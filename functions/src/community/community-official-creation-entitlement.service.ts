// functions/src/community/community-official-creation-entitlement.service.ts
// -----------------------------------------------------------------------------
// OFFICIAL COMMUNITY CREATION ENTITLEMENT SERVICE
// -----------------------------------------------------------------------------
// Resolve capacidades de Community exclusivamente a partir do entitlement
// Business/Official canônico. Associação/verificação oficial não concede
// capacidade comercial e assinatura pessoal não participa.
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';

import {
  buildBusinessOfficialEntitlementId,
  type BusinessOfficialEntitlementSubjectType,
} from '../business-official/business-official-entitlement.policy';
import {
  resolveBusinessOfficialEntitlementInTransaction,
} from '../business-official/business-official-entitlement.service';
import type { CommunityMemberLimit } from './community-capacity.policy';

export interface ResolvedOfficialCommunityCreationCapability {
  readonly allowed: boolean;
  readonly subjectType: BusinessOfficialEntitlementSubjectType | null;
  readonly subjectId: string | null;
  readonly memberLimit: CommunityMemberLimit | null;
  readonly maxOfficialCommunities: number | null;
  readonly policyVersion: number | null;
  readonly denialReason:
    | 'entitlement_required'
    | 'entitlement_inactive'
    | 'entitlement_mismatch'
    | null;
  readonly entitlementId: string | null;
}

export interface ResolvedOfficialVenueCreationCapability {
  readonly allowed: boolean;
  readonly subjectType: 'organization' | null;
  readonly subjectId: string | null;
  readonly memberLimit: CommunityMemberLimit | null;
  readonly maxOfficialSpaces: number | null;
  readonly policyVersion: number | null;
  readonly denialReason:
    | 'entitlement_required'
    | 'entitlement_inactive'
    | 'entitlement_mismatch'
    | null;
  readonly entitlementId: string | null;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

export function resolveOfficialCommunityCreationEntitlementSubject(input: {
  readonly actorUid: string;
  readonly sponsorOrganizationId: string | null;
}): Readonly<{
  subjectType: BusinessOfficialEntitlementSubjectType;
  subjectId: string;
}> | null {
  const actorUid = cleanId(input.actorUid);
  const sponsorOrganizationId = input.sponsorOrganizationId === null
    ? null
    : cleanId(input.sponsorOrganizationId);

  if (!actorUid) return null;
  if (
    input.sponsorOrganizationId !== null
    && sponsorOrganizationId === null
  ) {
    return null;
  }

  return sponsorOrganizationId
    ? Object.freeze({
      subjectType: 'organization' as const,
      subjectId: sponsorOrganizationId,
    })
    : Object.freeze({
      subjectType: 'user' as const,
      subjectId: actorUid,
    });
}

export function buildOfficialCommunityCreationEntitlementId(input: {
  readonly subjectType: BusinessOfficialEntitlementSubjectType;
  readonly subjectId: string;
}): string | null {
  return buildBusinessOfficialEntitlementId(input);
}

function deniedCommunityCapability(input: {
  readonly subjectType: BusinessOfficialEntitlementSubjectType | null;
  readonly subjectId: string | null;
  readonly entitlementId: string | null;
  readonly denialReason:
    | 'entitlement_required'
    | 'entitlement_inactive'
    | 'entitlement_mismatch';
}): Readonly<ResolvedOfficialCommunityCreationCapability> {
  return Object.freeze({
    allowed: false,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    memberLimit: null,
    maxOfficialCommunities: null,
    policyVersion: null,
    denialReason: input.denialReason,
    entitlementId: input.entitlementId,
  });
}

export async function resolveOfficialCommunityCreationEntitlementInTransaction(
  input: {
    readonly transaction: Transaction;
    readonly actorUid: string;
    readonly sponsorOrganizationId: string | null;
    readonly now: number;
  }
): Promise<Readonly<ResolvedOfficialCommunityCreationCapability>> {
  const subject = resolveOfficialCommunityCreationEntitlementSubject(input);
  if (!subject) {
    return deniedCommunityCapability({
      subjectType: null,
      subjectId: null,
      entitlementId: null,
      denialReason: 'entitlement_mismatch',
    });
  }

  const entitlement = await resolveBusinessOfficialEntitlementInTransaction({
    transaction: input.transaction,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    now: input.now,
  });

  if (!entitlement.allowed) {
    return deniedCommunityCapability({
      subjectType: entitlement.subjectType,
      subjectId: entitlement.subjectId,
      entitlementId: entitlement.entitlementId,
      denialReason: entitlement.denialReason ?? 'entitlement_required',
    });
  }

  const capability = entitlement.capabilities?.officialCommunityCreation;
  if (!capability) {
    return deniedCommunityCapability({
      subjectType: entitlement.subjectType,
      subjectId: entitlement.subjectId,
      entitlementId: entitlement.entitlementId,
      denialReason: 'entitlement_required',
    });
  }

  return Object.freeze({
    allowed: true,
    subjectType: entitlement.subjectType,
    subjectId: entitlement.subjectId,
    memberLimit: capability.memberLimit,
    maxOfficialCommunities: capability.maxOwned,
    policyVersion: entitlement.policyVersion,
    denialReason: null,
    entitlementId: entitlement.entitlementId,
  });
}

export async function resolveOfficialVenueCreationEntitlementInTransaction(
  input: {
    readonly transaction: Transaction;
    readonly organizationId: string;
    readonly now: number;
  }
): Promise<Readonly<ResolvedOfficialVenueCreationCapability>> {
  const organizationId = cleanId(input.organizationId);
  if (!organizationId) {
    return Object.freeze({
      allowed: false,
      subjectType: null,
      subjectId: null,
      memberLimit: null,
      maxOfficialSpaces: null,
      policyVersion: null,
      denialReason: 'entitlement_mismatch',
      entitlementId: null,
    });
  }

  const entitlement = await resolveBusinessOfficialEntitlementInTransaction({
    transaction: input.transaction,
    subjectType: 'organization',
    subjectId: organizationId,
    now: input.now,
  });

  if (!entitlement.allowed) {
    return Object.freeze({
      allowed: false,
      subjectType: 'organization',
      subjectId: organizationId,
      memberLimit: null,
      maxOfficialSpaces: null,
      policyVersion: null,
      denialReason: entitlement.denialReason ?? 'entitlement_required',
      entitlementId: entitlement.entitlementId,
    });
  }

  const capability = entitlement.capabilities?.officialVenueCreation;
  if (!capability) {
    return Object.freeze({
      allowed: false,
      subjectType: 'organization',
      subjectId: organizationId,
      memberLimit: null,
      maxOfficialSpaces: null,
      policyVersion: entitlement.policyVersion,
      denialReason: 'entitlement_required',
      entitlementId: entitlement.entitlementId,
    });
  }

  return Object.freeze({
    allowed: true,
    subjectType: 'organization',
    subjectId: organizationId,
    memberLimit: capability.memberLimit,
    maxOfficialSpaces: capability.maxOwned,
    policyVersion: entitlement.policyVersion,
    denialReason: null,
    entitlementId: entitlement.entitlementId,
  });
}
