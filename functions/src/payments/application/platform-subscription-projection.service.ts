// functions/src/payments/application/platform-subscription-projection.service.ts
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION PROJECTION SERVICE
// -----------------------------------------------------------------------------
// O entitlement determinístico é a verdade financeira. users/{uid} e
// public_profiles/{uid} são projeções operacionais rápidas, escritas somente
// quando o estado efetivo muda.
// -----------------------------------------------------------------------------

import { Timestamp } from 'firebase-admin/firestore';

import { db } from '../../firebaseApp';
import { PlatformRole } from '../domain/billing.model';
import {
  PlatformSubscriptionEntitlementStatus,
  getActivePlatformSubscriptionEntitlement,
} from './platform-subscription-entitlement.service';

export const PLATFORM_SUBSCRIPTION_PROJECTION_VERSION = 1;

export interface PlatformSubscriptionUserProjection {
  role: PlatformRole | 'free' | 'admin';
  tier: PlatformRole | 'free';
  isSubscriber: boolean;
  monthlyPayer: boolean;
  subscriptionStatus: 'active' | 'inactive';
  subscriptionScope: 'platform_subscription' | null;
  subscriptionStartedAt: Timestamp | null;
  subscriptionEndsAt: Timestamp | null;
  subscriptionExpires: Timestamp | null;
  billingProjectionVersion: number;
  billingUpdatedAt: number;
}

function toTimestampOrNull(value: number | null): Timestamp | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Timestamp.fromMillis(value)
    : null;
}

function toMillisOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    const millis = (value as { toMillis(): number }).toMillis();
    return Number.isFinite(millis) ? millis : null;
  }

  return null;
}

export function buildPlatformSubscriptionUserProjection(
  status: PlatformSubscriptionEntitlementStatus,
  currentRole: unknown,
  now = Date.now()
): PlatformSubscriptionUserProjection {
  const activeRole = status.active && status.role ? status.role : null;
  const preserveAdmin = currentRole === 'admin';

  return {
    role: preserveAdmin ? 'admin' : activeRole ?? 'free',
    tier: activeRole ?? 'free',
    isSubscriber: activeRole !== null,
    monthlyPayer: activeRole !== null,
    subscriptionStatus: activeRole ? 'active' : 'inactive',
    subscriptionScope: activeRole ? 'platform_subscription' : null,
    subscriptionStartedAt: toTimestampOrNull(status.startsAt),
    subscriptionEndsAt: toTimestampOrNull(status.endsAt),
    subscriptionExpires: toTimestampOrNull(status.endsAt),
    billingProjectionVersion: PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
    billingUpdatedAt: now,
  };
}

export function platformSubscriptionUserProjectionMatches(
  current: Record<string, unknown>,
  expected: PlatformSubscriptionUserProjection
): boolean {
  return (
    current['role'] === expected.role &&
    current['tier'] === expected.tier &&
    current['isSubscriber'] === expected.isSubscriber &&
    current['monthlyPayer'] === expected.monthlyPayer &&
    current['subscriptionStatus'] === expected.subscriptionStatus &&
    current['subscriptionScope'] === expected.subscriptionScope &&
    current['billingProjectionVersion'] ===
      expected.billingProjectionVersion &&
    toMillisOrNull(current['subscriptionStartedAt']) ===
      toMillisOrNull(expected.subscriptionStartedAt) &&
    toMillisOrNull(current['subscriptionEndsAt']) ===
      toMillisOrNull(expected.subscriptionEndsAt) &&
    toMillisOrNull(current['subscriptionExpires']) ===
      toMillisOrNull(expected.subscriptionExpires)
  );
}

export function resolvePublicPlatformRole(
  status: PlatformSubscriptionEntitlementStatus,
  currentRole: unknown
): PlatformRole | 'free' | 'admin' {
  if (currentRole === 'admin') return 'admin';
  return status.active && status.role ? status.role : 'free';
}

export function platformSubscriptionPublicProjectionMatches(
  current: Record<string, unknown>,
  expectedRole: PlatformRole | 'free' | 'admin'
): boolean {
  return (
    current['role'] === expectedRole &&
    current['billingProjectionVersion'] ===
      PLATFORM_SUBSCRIPTION_PROJECTION_VERSION
  );
}

export async function syncPlatformSubscriptionProjection(
  uid: string,
  status: PlatformSubscriptionEntitlementStatus,
  now = Date.now()
): Promise<void> {
  const userRef = db.collection('users').doc(uid);
  const publicProfileRef = db.collection('public_profiles').doc(uid);

  await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const [userSnapshot, publicProfileSnapshot] = await Promise.all([
      tx.get(userRef),
      tx.get(publicProfileRef),
    ]);

    if (!userSnapshot.exists) return;

    const currentUser = userSnapshot.data() ?? {};
    const userProjection = buildPlatformSubscriptionUserProjection(
      status,
      currentUser['role'],
      now
    );

    if (!platformSubscriptionUserProjectionMatches(
      currentUser,
      userProjection
    )) {
      tx.set(userRef, userProjection, { merge: true });
    }

    if (publicProfileSnapshot.exists) {
      const currentPublic = publicProfileSnapshot.data() ?? {};
      const publicRole = resolvePublicPlatformRole(
        status,
        currentPublic['role']
      );

      if (!platformSubscriptionPublicProjectionMatches(
        currentPublic,
        publicRole
      )) {
        tx.set(
          publicProfileRef,
          {
            role: publicRole,
            billingProjectionVersion:
              PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
            billingProjectionUpdatedAt: now,
          },
          { merge: true }
        );
      }
    }
  });
}

export async function reconcilePlatformSubscriptionAccess(
  uid: string,
  now = Date.now()
): Promise<PlatformSubscriptionEntitlementStatus> {
  const status = await getActivePlatformSubscriptionEntitlement(uid, now);
  await syncPlatformSubscriptionProjection(uid, status, now);
  return status;
}
