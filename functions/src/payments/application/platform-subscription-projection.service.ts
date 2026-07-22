// functions/src/payments/application/platform-subscription-projection.service.ts
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION PROJECTION SERVICE
// -----------------------------------------------------------------------------
// O entitlement determinístico é a verdade financeira. Este serviço mantém
// users/{uid} e public_profiles/{uid} como projeções operacionais rápidas.
//
// Regras:
// - nunca concede acesso sem entitlement ativo e vigente;
// - grava início/fim como Timestamp para comparação direta nas Firestore Rules;
// - mantém aliases legados sincronizados durante a migração;
// - não cria perfil público incompleto;
// - preserva role administrativo no documento privado.
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
    // Alias legado mantido sincronizado. Novas decisões usam subscriptionEndsAt.
    subscriptionExpires: toTimestampOrNull(status.endsAt),
    billingProjectionVersion: PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
    billingUpdatedAt: now,
  };
}

export function resolvePublicPlatformRole(
  status: PlatformSubscriptionEntitlementStatus,
  currentRole: unknown
): PlatformRole | 'free' | 'admin' {
  if (currentRole === 'admin') return 'admin';
  return status.active && status.role ? status.role : 'free';
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

    if (!userSnapshot.exists) {
      return;
    }

    const currentUser = userSnapshot.data() ?? {};
    const userProjection = buildPlatformSubscriptionUserProjection(
      status,
      currentUser['role'],
      now
    );

    tx.set(userRef, userProjection, { merge: true });

    if (publicProfileSnapshot.exists) {
      const currentPublic = publicProfileSnapshot.data() ?? {};
      const publicRole = resolvePublicPlatformRole(
        status,
        currentPublic['role']
      );

      tx.set(
        publicProfileRef,
        {
          role: publicRole,
          billingProjectionVersion: PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
          billingProjectionUpdatedAt: now,
        },
        { merge: true }
      );
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
