// functions/src/community/community-official-creation-entitlement.service.ts
// -----------------------------------------------------------------------------
// OFFICIAL COMMUNITY CREATION ENTITLEMENT SERVICE
// -----------------------------------------------------------------------------
// Resolve, dentro da mesma transação da criação, a capacidade comercial
// backend-only. A autoridade sobre Perfil/Organização/Local/Evento é resolvida
// antes por sua fonte canônica; este serviço decide apenas a capacidade do
// produto e a eventual quota de quantidade.
// -----------------------------------------------------------------------------

import type { Transaction } from 'firebase-admin/firestore';

import { db } from '../firebaseApp';
import {
  evaluateOfficialCommunityCreationEntitlement,
  type OfficialCommunityCreationCapability,
  type OfficialCommunityCreationEntitlementSubjectType,
} from './community-official-creation-entitlement.policy';

export interface ResolvedOfficialCommunityCreationCapability
  extends OfficialCommunityCreationCapability {
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
  subjectType: OfficialCommunityCreationEntitlementSubjectType;
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
  readonly subjectType: OfficialCommunityCreationEntitlementSubjectType;
  readonly subjectId: string;
}): string | null {
  const subjectId = cleanId(input.subjectId);
  return subjectId
    ? `official_community_creation:${input.subjectType}:${subjectId}`
    : null;
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
    return Object.freeze({
      allowed: false,
      subjectType: null,
      subjectId: null,
      memberLimit: null,
      maxOfficialCommunities: null,
      policyVersion: null,
      denialReason: 'entitlement_mismatch',
      entitlementId: null,
    });
  }

  const entitlementId = buildOfficialCommunityCreationEntitlementId(subject);
  if (!entitlementId) {
    return Object.freeze({
      allowed: false,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      memberLimit: null,
      maxOfficialCommunities: null,
      policyVersion: null,
      denialReason: 'entitlement_mismatch',
      entitlementId: null,
    });
  }

  const entitlementSnapshot = await input.transaction.get(
    db.collection('entitlements').doc(entitlementId)
  );
  const capability = evaluateOfficialCommunityCreationEntitlement({
    expectedSubjectType: subject.subjectType,
    expectedSubjectId: subject.subjectId,
    rawEntitlement: entitlementSnapshot.exists
      ? entitlementSnapshot.data()
      : null,
    now: input.now,
  });

  return Object.freeze({
    ...capability,
    entitlementId,
  });
}
