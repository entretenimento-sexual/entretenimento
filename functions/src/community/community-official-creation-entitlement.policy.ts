// functions/src/community/community-official-creation-entitlement.policy.ts
// -----------------------------------------------------------------------------
// OFFICIAL COMMUNITY CREATION ENTITLEMENT ADAPTER
// -----------------------------------------------------------------------------
// Adapter de Community sobre a fonte canônica Business/Official.
//
// community_official_associations não participa desta decisão. O entitlement
// canônico informa capacidade efetiva; a autoridade sobre o alvo oficial é
// resolvida por outra fronteira.
// -----------------------------------------------------------------------------

import {
  BUSINESS_OFFICIAL_ENTITLEMENT_POLICY_VERSION,
  MAX_BUSINESS_OFFICIAL_CREATIONS,
  evaluateBusinessOfficialEntitlement,
  type BusinessOfficialEntitlementSubjectType,
} from '../business-official/business-official-entitlement.policy';
import type {
  CommunityMemberLimit,
} from './community-capacity.policy';

export const OFFICIAL_COMMUNITY_CREATION_ENTITLEMENT_POLICY_VERSION =
  BUSINESS_OFFICIAL_ENTITLEMENT_POLICY_VERSION;
export const MAX_OFFICIAL_COMMUNITIES_PER_ENTITLEMENT =
  MAX_BUSINESS_OFFICIAL_CREATIONS;

export type OfficialCommunityCreationEntitlementSubjectType =
  BusinessOfficialEntitlementSubjectType;

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
  readonly maxOfficialCommunities: number | null;
  readonly policyVersion: number | null;
  readonly denialReason: OfficialCommunityCreationEntitlementDenialReason;
}

export function evaluateOfficialCommunityCreationEntitlement(input: {
  readonly expectedSubjectType: OfficialCommunityCreationEntitlementSubjectType;
  readonly expectedSubjectId: string;
  readonly rawEntitlement: unknown;
  readonly now?: number;
}): Readonly<OfficialCommunityCreationCapability> {
  const entitlement = evaluateBusinessOfficialEntitlement({
    expectedSubjectType: input.expectedSubjectType,
    expectedSubjectId: input.expectedSubjectId,
    rawEntitlement: input.rawEntitlement,
    now: input.now,
  });

  if (!entitlement.allowed) {
    return Object.freeze({
      allowed: false,
      subjectType: entitlement.subjectType,
      subjectId: entitlement.subjectId,
      memberLimit: null,
      maxOfficialCommunities: null,
      policyVersion: null,
      denialReason: entitlement.denialReason,
    });
  }

  const capability = entitlement.capabilities?.officialCommunityCreation;
  if (!capability) {
    return Object.freeze({
      allowed: false,
      subjectType: entitlement.subjectType,
      subjectId: entitlement.subjectId,
      memberLimit: null,
      maxOfficialCommunities: null,
      policyVersion: entitlement.policyVersion,
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
  });
}
