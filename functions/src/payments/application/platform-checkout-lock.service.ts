// functions/src/payments/application/platform-checkout-lock.service.ts
// -----------------------------------------------------------------------------
// PLATFORM CHECKOUT LOCK
// -----------------------------------------------------------------------------
// Impede múltiplos checkouts recorrentes simultâneos para o mesmo comprador.
// Além de reduzir cobrança duplicada, torna a conciliação assíncrona determinista.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import type {
  PlatformCheckoutLockDoc,
} from '../domain/platform-recurring-subscription.model';

export const PLATFORM_CHECKOUT_LOCK_COLLECTION =
  'platform_subscription_checkout_locks';

export async function acquirePlatformCheckoutLock(input: {
  buyerUid: string;
  checkoutSessionId: string;
  expiresAt: number;
  now?: number;
}): Promise<void> {
  const now = input.now ?? Date.now();
  const ref = db
    .collection(PLATFORM_CHECKOUT_LOCK_COLLECTION)
    .doc(input.buyerUid);

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const current = snapshot.exists
      ? snapshot.data() as PlatformCheckoutLockDoc
      : null;

    if (
      current &&
      current.checkoutSessionId !== input.checkoutSessionId &&
      Number.isFinite(current.expiresAt) &&
      current.expiresAt > now
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Já existe um checkout de assinatura em andamento.',
        {
          reason: 'subscription_checkout_already_open',
          retryAfterMs: Math.max(1, current.expiresAt - now),
        }
      );
    }

    const doc: PlatformCheckoutLockDoc = {
      buyerUid: input.buyerUid,
      checkoutSessionId: input.checkoutSessionId,
      expiresAt: input.expiresAt,
      createdAt:
        current?.checkoutSessionId === input.checkoutSessionId
          ? current.createdAt
          : now,
      updatedAt: now,
    };

    tx.set(ref, doc, { merge: false });
  });
}

export async function releasePlatformCheckoutLock(input: {
  buyerUid: string;
  checkoutSessionId: string;
}): Promise<boolean> {
  const ref = db
    .collection(PLATFORM_CHECKOUT_LOCK_COLLECTION)
    .doc(input.buyerUid);
  let released = false;

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;

    const current = snapshot.data() as PlatformCheckoutLockDoc;
    if (current.checkoutSessionId !== input.checkoutSessionId) return;

    tx.delete(ref);
    released = true;
  });

  return released;
}
