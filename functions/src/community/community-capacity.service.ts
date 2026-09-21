// functions/src/community/community-capacity.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAPACITY SERVICE
// -----------------------------------------------------------------------------
// Conecta a policy pura de capacidade às fontes canônicas:
// - Comunidade pessoal -> entitlement de assinatura do proprietário;
// - Comunidade Official -> associação responde "é oficial/quem responde" e o
//   entitlement Business/Official responde "quanto pode consumir".
//
// A capacidade persistida na Comunidade é um snapshot operacional e nunca
// substitui a revalidação do entitlement vigente para novas admissões.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import {
  buildBusinessOfficialEntitlementId,
  evaluateBusinessOfficialEntitlement,
  type BusinessOfficialEntitlementDecision,
  type BusinessOfficialEntitlementSubjectType,
} from '../business-official/business-official-entitlement.policy';
import {
  resolveBusinessOfficialEntitlementInTransaction,
} from '../business-official/business-official-entitlement.service';
import { db } from '../firebaseApp';
import {
  evaluatePlatformSubscriptionEntitlement,
} from '../payments/application/platform-subscription-entitlement.service';
import { isCommunityAdmissionOperational } from './community-admission-operational.policy';
import {
  type CommunityCapacityState,
  evaluateCommunityCapacity,
  evaluateCommunityCapacityAgainstLimit,
  resolveCommunityCapacitySponsorRole,
} from './community-capacity.policy';
import {
  normalizeCommunityOfficialAssociationKey,
} from './community-official-association.model';

const SAFE_UID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;

type OfficialCapacityCapabilityName =
  | 'officialCommunityCreation'
  | 'officialVenueCreation';

interface OfficialEntitlementSubject {
  readonly subjectType: BusinessOfficialEntitlementSubjectType;
  readonly subjectId: string;
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : {};
}

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_UID_PATTERN.test(normalized) ? normalized : null;
}

function officialAssociationKey(rawCommunity: unknown): string | null {
  const community = asRecord(rawCommunity);
  return normalizeCommunityOfficialAssociationKey(
    community['officialAssociationKey']
  );
}

export function resolveOfficialCommunityEntitlementSubject(
  rawCommunity: unknown,
  rawAssociation: unknown
): Readonly<OfficialEntitlementSubject> | null {
  const associationKey = officialAssociationKey(rawCommunity);
  const association = asRecord(rawAssociation);

  if (
    !associationKey
    || association['status'] !== 'verified'
    || normalizeCommunityOfficialAssociationKey(
      association['associationKey']
    ) !== associationKey
  ) {
    return null;
  }

  const rawSponsorOrganizationId = association['sponsorOrganizationId'];
  if (rawSponsorOrganizationId !== null) {
    const organizationId = cleanId(rawSponsorOrganizationId);
    return organizationId
      ? Object.freeze({
        subjectType: 'organization' as const,
        subjectId: organizationId,
      })
      : null;
  }

  const authority = asRecord(association['authority']);
  const holderUid = cleanId(authority['holderUid']);
  return holderUid
    ? Object.freeze({
      subjectType: 'user' as const,
      subjectId: holderUid,
    })
    : null;
}

export function resolveOfficialCommunityCapacityCapabilityName(
  rawCommunity: unknown
): OfficialCapacityCapabilityName {
  const community = asRecord(rawCommunity);
  const capacity = asRecord(community['capacity']);
  const explicit = capacity['entitlementCapability'];

  if (
    explicit === 'officialCommunityCreation'
    || explicit === 'officialVenueCreation'
  ) {
    return explicit;
  }

  // Compatibilidade de migração:
  // createVenueCommunity historicamente não persistia lifecycle, enquanto
  // createOfficialCommunity persiste. Novos registros sempre gravam o
  // discriminador explícito e deixam de depender desta inferência.
  const source = asRecord(community['source']);
  const lifecycle = community['lifecycle'];
  return source['type'] === 'venue'
    && (typeof lifecycle !== 'object' || lifecycle === null)
    ? 'officialVenueCreation'
    : 'officialCommunityCreation';
}

function evaluateOfficialCapacityFromEntitlementDecision(input: {
  readonly rawCommunity: unknown;
  readonly entitlement: Readonly<BusinessOfficialEntitlementDecision> | null;
}): Readonly<CommunityCapacityState> {
  const capabilityName = resolveOfficialCommunityCapacityCapabilityName(
    input.rawCommunity
  );
  const capability = input.entitlement?.allowed
    ? input.entitlement.capabilities?.[capabilityName] ?? null
    : null;

  return evaluateCommunityCapacityAgainstLimit({
    rawCommunity: input.rawCommunity,
    sponsorLimit: capability?.memberLimit ?? 0,
    zeroLimitReason: 'official_entitlement_required',
    restrictedReason: 'capacity_over_entitlement',
  });
}

export function isOfficialCommunityCapacity(
  rawCommunity: unknown
): boolean {
  const community = asRecord(rawCommunity);
  const capacity = asRecord(community['capacity']);
  const source = asRecord(community['source']);

  if (capacity['sponsorType'] === 'official') return true;
  if (capacity['sponsorType'] === 'personal') return false;

  // Compatibilidade com Locais criados antes da marcação explícita do sponsor.
  return source['type'] === 'venue';
}

export function resolveCommunityCapacityOwnerUid(
  rawCommunity: unknown
): string | null {
  const community = asRecord(rawCommunity);
  const ownerUid = String(community['ownerUid'] ?? '').trim();
  return SAFE_UID_PATTERN.test(ownerUid) ? ownerUid : null;
}

export function evaluateOfficialCommunityCapacity(input: {
  readonly rawCommunity: unknown;
  readonly rawOfficialAssociation: unknown;
  readonly rawOfficialEntitlement: unknown;
  readonly now?: number;
}): Readonly<CommunityCapacityState> {
  const subject = resolveOfficialCommunityEntitlementSubject(
    input.rawCommunity,
    input.rawOfficialAssociation
  );

  if (!subject) {
    return evaluateOfficialCapacityFromEntitlementDecision({
      rawCommunity: input.rawCommunity,
      entitlement: null,
    });
  }

  const entitlement = evaluateBusinessOfficialEntitlement({
    expectedSubjectType: subject.subjectType,
    expectedSubjectId: subject.subjectId,
    rawEntitlement: input.rawOfficialEntitlement,
    now: input.now,
  });

  return evaluateOfficialCapacityFromEntitlementDecision({
    rawCommunity: input.rawCommunity,
    entitlement,
  });
}

export function evaluateCommunityCapacityForOwner(input: {
  rawCommunity: unknown;
  rawOwnerEntitlement: unknown;
  rawOwnerUser: unknown;
  rawOfficialAssociation?: unknown;
  rawOfficialEntitlement?: unknown;
  now?: number;
}): Readonly<CommunityCapacityState> | null {
  if (isOfficialCommunityCapacity(input.rawCommunity)) {
    return evaluateOfficialCommunityCapacity({
      rawCommunity: input.rawCommunity,
      rawOfficialAssociation: input.rawOfficialAssociation,
      rawOfficialEntitlement: input.rawOfficialEntitlement,
      now: input.now,
    });
  }

  const ownerUid = resolveCommunityCapacityOwnerUid(input.rawCommunity);
  if (!ownerUid) return null;

  const entitlement = evaluatePlatformSubscriptionEntitlement(
    input.rawOwnerEntitlement,
    ownerUid,
    input.now
  );
  const ownerUser = asRecord(input.rawOwnerUser);
  const sponsorRole = resolveCommunityCapacitySponsorRole(
    entitlement.active ? entitlement.role : null,
    ownerUser['role']
  );

  return evaluateCommunityCapacity({
    rawCommunity: input.rawCommunity,
    sponsorRole,
  });
}

async function getOfficialCapacityInTransaction(
  transaction: FirebaseFirestore.Transaction,
  rawCommunity: unknown,
  now: number
): Promise<Readonly<CommunityCapacityState>> {
  const associationKey = officialAssociationKey(rawCommunity);
  if (!associationKey) {
    return evaluateOfficialCapacityFromEntitlementDecision({
      rawCommunity,
      entitlement: null,
    });
  }

  const associationSnapshot = await transaction.get(
    db.collection('community_official_associations').doc(associationKey)
  );
  const association = associationSnapshot.exists
    ? associationSnapshot.data()
    : null;
  const subject = resolveOfficialCommunityEntitlementSubject(rawCommunity, association);

  if (!subject) {
    return evaluateOfficialCapacityFromEntitlementDecision({
      rawCommunity,
      entitlement: null,
    });
  }

  const entitlement =
    await resolveBusinessOfficialEntitlementInTransaction({
      transaction,
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      now,
    });

  return evaluateOfficialCapacityFromEntitlementDecision({
    rawCommunity,
    entitlement,
  });
}

export async function getCommunityCapacityForOwnerInTransaction(
  transaction: FirebaseFirestore.Transaction,
  rawCommunity: unknown,
  now = Date.now()
): Promise<Readonly<CommunityCapacityState> | null> {
  if (!isCommunityAdmissionOperational(rawCommunity)) {
    throw new HttpsError(
      'failed-precondition',
      'Esta Comunidade não está disponível para novas entradas agora.',
      { reason: 'community_not_manageable' }
    );
  }

  if (isOfficialCommunityCapacity(rawCommunity)) {
    return getOfficialCapacityInTransaction(transaction, rawCommunity, now);
  }

  const ownerUid = resolveCommunityCapacityOwnerUid(rawCommunity);
  if (!ownerUid) return null;

  const [ownerUserSnapshot, ownerEntitlementSnapshot] = await Promise.all([
    transaction.get(db.collection('users').doc(ownerUid)),
    transaction.get(
      db.collection('entitlements').doc(`platform_subscription_${ownerUid}`)
    ),
  ]);

  return evaluateCommunityCapacityForOwner({
    rawCommunity,
    rawOwnerUser: ownerUserSnapshot.exists ? ownerUserSnapshot.data() : null,
    rawOwnerEntitlement: ownerEntitlementSnapshot.exists
      ? ownerEntitlementSnapshot.data()
      : null,
    now,
  });
}

async function getOfficialCapacity(
  rawCommunity: unknown,
  now: number
): Promise<Readonly<CommunityCapacityState>> {
  const associationKey = officialAssociationKey(rawCommunity);
  if (!associationKey) {
    return evaluateOfficialCapacityFromEntitlementDecision({
      rawCommunity,
      entitlement: null,
    });
  }

  const associationSnapshot = await db
    .collection('community_official_associations')
    .doc(associationKey)
    .get();
  const association = associationSnapshot.exists
    ? associationSnapshot.data()
    : null;
  const subject = resolveOfficialCommunityEntitlementSubject(rawCommunity, association);

  if (!subject) {
    return evaluateOfficialCapacityFromEntitlementDecision({
      rawCommunity,
      entitlement: null,
    });
  }

  const entitlementId = buildBusinessOfficialEntitlementId(subject);
  if (!entitlementId) {
    return evaluateOfficialCapacityFromEntitlementDecision({
      rawCommunity,
      entitlement: null,
    });
  }

  const entitlementSnapshot = await db
    .collection('entitlements')
    .doc(entitlementId)
    .get();
  const entitlement = evaluateBusinessOfficialEntitlement({
    expectedSubjectType: subject.subjectType,
    expectedSubjectId: subject.subjectId,
    rawEntitlement: entitlementSnapshot.exists
      ? entitlementSnapshot.data()
      : null,
    now,
  });

  return evaluateOfficialCapacityFromEntitlementDecision({
    rawCommunity,
    entitlement,
  });
}

export async function getCommunityCapacityForOwner(
  rawCommunity: unknown,
  now = Date.now()
): Promise<Readonly<CommunityCapacityState> | null> {
  if (isOfficialCommunityCapacity(rawCommunity)) {
    return getOfficialCapacity(rawCommunity, now);
  }

  const ownerUid = resolveCommunityCapacityOwnerUid(rawCommunity);
  if (!ownerUid) return null;

  const [ownerUserSnapshot, ownerEntitlementSnapshot] = await Promise.all([
    db.collection('users').doc(ownerUid).get(),
    db.collection('entitlements').doc(`platform_subscription_${ownerUid}`).get(),
  ]);

  return evaluateCommunityCapacityForOwner({
    rawCommunity,
    rawOwnerUser: ownerUserSnapshot.exists ? ownerUserSnapshot.data() : null,
    rawOwnerEntitlement: ownerEntitlementSnapshot.exists
      ? ownerEntitlementSnapshot.data()
      : null,
    now,
  });
}

export function assertCommunityAcceptingNewMembers(
  state: Readonly<CommunityCapacityState> | null
): asserts state is Readonly<CommunityCapacityState> {
  if (!state || state.memberCount === null) {
    throw new HttpsError(
      'data-loss',
      'A capacidade atual da Comunidade está inconsistente.'
    );
  }

  if (!state.acceptingNewMembers) {
    throw new HttpsError(
      'failed-precondition',
      'Esta Comunidade atingiu a capacidade disponível para novas entradas.',
      {
        reason: 'community_capacity_reached',
        configuredLimit: state.configuredLimit,
        effectiveLimit: state.effectiveLimit,
        memberCount: state.memberCount,
        restrictedByOwnerPlan: state.restrictedByOwnerPlan,
        regularizationRequired: state.regularizationRequired,
        regularizationReason: state.regularizationReason,
      }
    );
  }
}
