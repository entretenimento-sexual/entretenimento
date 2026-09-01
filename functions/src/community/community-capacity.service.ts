// functions/src/community/community-capacity.service.ts
// -----------------------------------------------------------------------------
// COMMUNITY CAPACITY SERVICE
// -----------------------------------------------------------------------------
// Conecta a policy pura de capacidade ao entitlement canônico do proprietário.
// -----------------------------------------------------------------------------

import { db } from '../firebaseApp';
import {
  evaluatePlatformSubscriptionEntitlement,
} from '../payments/application/platform-subscription-entitlement.service';
import { HttpsError } from 'firebase-functions/v2/https';
import {
  CommunityCapacityState,
  evaluateCommunityCapacity,
  resolveCommunityCapacitySponsorRole,
} from './community-capacity.policy';

const SAFE_UID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;

export function resolveCommunityCapacityOwnerUid(
  rawCommunity: unknown
): string | null {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const ownerUid = String(community['ownerUid'] ?? '').trim();
  return SAFE_UID_PATTERN.test(ownerUid) ? ownerUid : null;
}

export function evaluateCommunityCapacityForOwner(input: {
  rawCommunity: unknown;
  rawOwnerEntitlement: unknown;
  rawOwnerUser: unknown;
  now?: number;
}): Readonly<CommunityCapacityState> | null {
  const community = (input.rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;

  if (source['type'] === 'venue') {
    return evaluateCommunityCapacity({
      rawCommunity: input.rawCommunity,
      sponsorRole: 'official_space',
    });
  }

  const ownerUid = resolveCommunityCapacityOwnerUid(input.rawCommunity);
  if (!ownerUid) return null;

  const entitlement = evaluatePlatformSubscriptionEntitlement(
    input.rawOwnerEntitlement,
    ownerUid,
    input.now
  );
  const ownerUser = (input.rawOwnerUser ?? {}) as Record<string, unknown>;
  const sponsorRole = resolveCommunityCapacitySponsorRole(
    entitlement.active ? entitlement.role : null,
    ownerUser['role']
  );

  return evaluateCommunityCapacity({
    rawCommunity: input.rawCommunity,
    sponsorRole,
  });
}

export async function getCommunityCapacityForOwnerInTransaction(
  transaction: FirebaseFirestore.Transaction,
  rawCommunity: unknown,
  now = Date.now()
): Promise<Readonly<CommunityCapacityState> | null> {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;

  if (source['type'] === 'venue') {
    return evaluateCommunityCapacity({
      rawCommunity,
      sponsorRole: 'official_space',
    });
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

export async function getCommunityCapacityForOwner(
  rawCommunity: unknown,
  now = Date.now()
): Promise<Readonly<CommunityCapacityState> | null> {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;

  if (source['type'] === 'venue') {
    return evaluateCommunityCapacity({
      rawCommunity,
      sponsorRole: 'official_space',
    });
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
