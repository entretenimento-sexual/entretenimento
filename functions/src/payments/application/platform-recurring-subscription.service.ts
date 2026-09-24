// functions/src/payments/application/platform-recurring-subscription.service.ts
// -----------------------------------------------------------------------------
// PLATFORM RECURRING SUBSCRIPTION SERVICE
// -----------------------------------------------------------------------------
// Concilia Checkout/Subscription do Asaas com contratos internos recorrentes.
// Nenhuma operação neste arquivo concede entitlement; isso pertence ao
// settlement de cobranças confirmadas.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import type {
  CheckoutSessionDoc,
} from '../domain/billing.model';
import type {
  VerifiedProviderWebhookEvent,
} from '../domain/provider-webhook.model';
import type {
  PlatformRecurringSubscriptionDoc,
  PlatformRecurringSubscriptionStateDoc,
} from '../domain/platform-recurring-subscription.model';
import {
  releasePlatformCheckoutLock,
} from './platform-checkout-lock.service';
import {
  evaluateRecurringSubscriptionAmountIntegrity,
} from './recurring-subscription-integrity.policy';

export const PLATFORM_SUBSCRIPTION_COLLECTION = 'subscriptions';
export const PLATFORM_SUBSCRIPTION_STATE_COLLECTION =
  'platform_subscription_state';

const MATCH_WINDOW_MS = 24 * 60 * 60 * 1_000;

export class RetryableProviderWebhookError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'RetryableProviderWebhookError';
    this.code = code;
  }
}

export function buildRecurringSubscriptionContractId(
  providerSubscriptionId: string
): string {
  const digest = createHash('sha256')
    .update(`asaas:${providerSubscriptionId}`)
    .digest('hex')
    .slice(0, 48);

  return `platform_recurring_${digest}`;
}

export async function findRecurringContractByProviderSubscriptionId(
  providerSubscriptionId: string
): Promise<PlatformRecurringSubscriptionDoc | null> {
  const id = buildRecurringSubscriptionContractId(providerSubscriptionId);
  const snapshot = await db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(id)
    .get();

  return snapshot.exists
    ? snapshot.data() as PlatformRecurringSubscriptionDoc
    : null;
}

async function findCheckoutByProviderSessionId(
  providerSessionId: string
): Promise<CheckoutSessionDoc | null> {
  const snapshot = await db
    .collection('checkout_sessions')
    .where('providerSessionId', '==', providerSessionId)
    .limit(2)
    .get();

  if (snapshot.size > 1) {
    throw new HttpsError(
      'failed-precondition',
      'Mais de um checkout interno aponta para a mesma sessão financeira.'
    );
  }

  return snapshot.empty
    ? null
    : snapshot.docs[0]!.data() as CheckoutSessionDoc;
}

async function findCheckoutForSubscriptionEvent(
  event: VerifiedProviderWebhookEvent
): Promise<CheckoutSessionDoc> {
  if (event.externalReference) {
    const direct = await db
      .collection('checkout_sessions')
      .doc(event.externalReference)
      .get();

    if (direct.exists) {
      const data = direct.data() as CheckoutSessionDoc;
      if (data.provider === 'asaas') return data;
    }
  }

  if (!event.customerId) {
    throw new RetryableProviderWebhookError(
      'subscription-checkout-mapping-pending',
      'Assinatura ainda sem customer para conciliação do checkout.'
    );
  }

  const candidates = await db
    .collection('checkout_sessions')
    .where('providerCustomerId', '==', event.customerId)
    .limit(20)
    .get();
  const now = event.occurredAt || Date.now();
  const matching = candidates.docs
    .map((document) => document.data() as CheckoutSessionDoc)
    .filter((checkout) => {
      const openStatus =
        checkout.status === 'provider_created' ||
        checkout.status === 'processing';
      const amountMatches =
        event.amountCents === null ||
        checkout.amountCents === event.amountCents;
      const recent =
        Number.isFinite(checkout.createdAt) &&
        Math.abs(now - checkout.createdAt) <= MATCH_WINDOW_MS;

      return checkout.provider === 'asaas'
        && openStatus
        && amountMatches
        && recent;
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  if (matching.length !== 1) {
    throw new RetryableProviderWebhookError(
      'subscription-checkout-mapping-ambiguous',
      'Ainda não foi possível relacionar a assinatura ao checkout interno.'
    );
  }

  return matching[0]!;
}

async function quarantineRecurringSubscriptionAmountMismatch(input: {
  readonly contractId: string;
  readonly contractRef: FirebaseFirestore.DocumentReference;
  readonly contract: PlatformRecurringSubscriptionDoc;
  readonly event: VerifiedProviderWebhookEvent;
  readonly now: number;
}): Promise<void> {
  const stateRef = db
    .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
    .doc(input.contract.buyerUid);

  await db.runTransaction(async (tx) => {
    const stateSnapshot = await tx.get(stateRef);
    const state = stateSnapshot.exists
      ? stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
      : null;

    tx.set(
      input.contractRef,
      {
        status:
          input.contract.status === 'pending_payment'
            ? 'canceled'
            : input.contract.status,
        renewalEnabled: false,
        needsProviderCancellation: true,
        providerCancellationNextAttemptAt: input.now,
        canceledAt:
          input.contract.canceledAt
          ?? (input.contract.status === 'pending_payment' ? input.now : null),
        lastPaymentStatus:
          input.event.providerStatus ?? input.contract.lastPaymentStatus,
        updatedAt: input.now,
      },
      { merge: true }
    );

    if (state?.currentContractId === input.contractId) {
      tx.set(
        stateRef,
        {
          renewalEnabled: false,
          updatedAt: input.now,
        },
        { merge: true }
      );
    }

    tx.set(db.collection('billing_audit').doc(), {
      action: 'recurring_subscription_amount_mismatch',
      buyerUid: input.contract.buyerUid,
      contractId: input.contractId,
      providerSubscriptionId: input.contract.providerSubscriptionId,
      providerEventId: input.event.providerEventId,
      expectedAmountCents: input.contract.amountCents,
      providerAmountCents: input.event.amountCents,
      accessRevoked: false,
      providerCancellationScheduled: true,
      createdAt: input.now,
    });
  });
}

export async function applyAsaasCheckoutLifecycleEvent(
  event: VerifiedProviderWebhookEvent
): Promise<'processed' | 'ignored'> {
  if (event.resourceType !== 'checkout' || !event.checkoutId) {
    return 'ignored';
  }

  const checkout = event.externalReference
    ? await db.collection('checkout_sessions').doc(event.externalReference).get()
      .then((snapshot) =>
        snapshot.exists
          ? snapshot.data() as CheckoutSessionDoc
          : null
      )
    : await findCheckoutByProviderSessionId(event.checkoutId);

  const resolvedCheckout =
    checkout?.providerSessionId === event.checkoutId
      ? checkout
      : await findCheckoutByProviderSessionId(event.checkoutId);

  if (!resolvedCheckout) {
    throw new RetryableProviderWebhookError(
      'checkout-mapping-pending',
      'Checkout Asaas ainda não está relacionado à sessão interna.'
    );
  }

  const checkoutRef = db
    .collection('checkout_sessions')
    .doc(resolvedCheckout.id);
  const lifecycleStatus =
    event.eventName === 'CHECKOUT_PAID'
      ? 'processing'
      : event.eventName === 'CHECKOUT_CANCELED'
        ? 'canceled'
        : event.eventName === 'CHECKOUT_EXPIRED'
          ? 'expired'
          : event.eventName === 'CHECKOUT_CREATED'
            ? resolvedCheckout.status
            : null;

  if (!lifecycleStatus) return 'ignored';

  const now = Date.now();
  const metadata = {
    ...(resolvedCheckout.metadata ?? {}),
    ...(event.eventName === 'CHECKOUT_PAID'
      ? { checkoutPaidAt: event.occurredAt }
      : {}),
    lastProviderCheckoutEvent: event.eventName,
  };

  await checkoutRef.set(
    {
      providerCustomerId:
        event.customerId ?? resolvedCheckout.providerCustomerId ?? null,
      status: lifecycleStatus,
      updatedAt: now,
      metadata,
      statusHistory:
        event.eventName === 'CHECKOUT_CREATED'
          ? (resolvedCheckout.statusHistory ?? [])
          : [
            ...(resolvedCheckout.statusHistory ?? []),
            {
              status: lifecycleStatus,
              at: event.occurredAt,
              source: 'provider',
              eventId: event.providerEventId,
            },
          ],
    },
    { merge: true }
  );

  if (
    lifecycleStatus === 'canceled' ||
    lifecycleStatus === 'expired'
  ) {
    await releasePlatformCheckoutLock({
      buyerUid: resolvedCheckout.buyerUid,
      checkoutSessionId: resolvedCheckout.id,
    });
  }

  return 'processed';
}

export async function applyAsaasSubscriptionLifecycleEvent(
  event: VerifiedProviderWebhookEvent
): Promise<'processed' | 'ignored'> {
  if (event.resourceType !== 'subscription' || !event.subscriptionId) {
    return 'ignored';
  }

  const contractId = buildRecurringSubscriptionContractId(
    event.subscriptionId
  );
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(contractId);
  const existing = await contractRef.get();

  if (event.eventName === 'SUBSCRIPTION_CREATED') {
    if (existing.exists) {
      const current =
        existing.data() as PlatformRecurringSubscriptionDoc;
      const integrity = evaluateRecurringSubscriptionAmountIntegrity({
        contractAmountCents: current.amountCents,
        providerAmountCents: event.amountCents,
      });

      if (integrity === 'mismatch') {
        await quarantineRecurringSubscriptionAmountMismatch({
          contractId,
          contractRef,
          contract: current,
          event,
          now: Date.now(),
        });
        if (current.status === 'pending_payment') {
          await releasePlatformCheckoutLock({
            buyerUid: current.buyerUid,
            checkoutSessionId: current.sourceCheckoutSessionId,
          }).catch(() => false);
        }
        return 'processed';
      }

      await contractRef.set(
        {
          providerCustomerId:
            event.customerId ??
            current.providerCustomerId ??
            null,
          lastPaymentStatus:
            event.providerStatus ?? current.lastPaymentStatus,
          updatedAt: Date.now(),
        },
        { merge: true }
      );
      return 'processed';
    }

    const checkout = await findCheckoutForSubscriptionEvent(event);
    const planSnapshot = checkout.planSnapshot;

    if (!planSnapshot) {
      throw new HttpsError(
        'failed-precondition',
        'Checkout sem snapshot de plano para criar contrato recorrente.'
      );
    }

    const now = Date.now();
    const amountIntegrity = evaluateRecurringSubscriptionAmountIntegrity({
      contractAmountCents: checkout.amountCents,
      providerAmountCents: event.amountCents,
    });
    const amountMismatch = amountIntegrity === 'mismatch';
    const contract: PlatformRecurringSubscriptionDoc = {
      id: contractId,
      buyerUid: checkout.buyerUid,
      scope: 'platform_subscription',
      provider: 'asaas',
      providerSubscriptionId: event.subscriptionId,
      providerCustomerId:
        event.customerId ?? checkout.providerCustomerId ?? null,
      sourceCheckoutSessionId: checkout.id,
      planId: planSnapshot.id,
      planKey: planSnapshot.key,
      grantedRole: planSnapshot.grantedRole,
      planSnapshot,
      amountCents: checkout.amountCents,
      currency: checkout.currency,
      cycle: 'MONTHLY',
      status: amountMismatch ? 'canceled' : 'pending_payment',
      renewalEnabled: !amountMismatch,
      isCurrent: false,
      lastSettledProviderPaymentId: null,
      lastPaymentStatus: null,
      lastPaymentOccurredAt: null,
      needsProviderCancellation: amountMismatch,
      providerCancellationAttemptCount: 0,
      providerCancellationNextAttemptAt: amountMismatch ? now : null,
      providerCancellationLastErrorCode: null,
      createdAt: now,
      activatedAt: null,
      canceledAt: amountMismatch ? now : null,
      supersededAt: null,
      updatedAt: now,
    };

    await db.runTransaction(async (tx) => {
      const fresh = await tx.get(contractRef);
      if (fresh.exists) return;

      tx.create(contractRef, contract);
      tx.set(
        db.collection('checkout_sessions').doc(checkout.id),
        {
          providerSubscriptionId: event.subscriptionId,
          providerCustomerId: contract.providerCustomerId,
          ...(amountMismatch
            ? {
              status: 'failed',
              statusHistory: [
                ...(checkout.statusHistory ?? []),
                {
                  status: 'failed',
                  at: now,
                  source: 'provider',
                  eventId: event.providerEventId,
                },
              ],
              metadata: {
                ...(checkout.metadata ?? {}),
                failureReason:
                  'recurring_subscription_amount_mismatch',
              },
            }
            : {}),
          updatedAt: now,
        },
        { merge: true }
      );

      if (amountMismatch) {
        tx.set(db.collection('billing_audit').doc(), {
          action: 'recurring_subscription_amount_mismatch',
          buyerUid: contract.buyerUid,
          contractId,
          providerSubscriptionId: event.subscriptionId,
          providerEventId: event.providerEventId,
          expectedAmountCents: checkout.amountCents,
          providerAmountCents: event.amountCents,
          accessRevoked: false,
          providerCancellationScheduled: true,
          createdAt: now,
        });
      }
    });

    if (amountMismatch) {
      await releasePlatformCheckoutLock({
        buyerUid: checkout.buyerUid,
        checkoutSessionId: checkout.id,
      }).catch(() => false);
    }

    return 'processed';
  }

  if (!existing.exists) {
    throw new RetryableProviderWebhookError(
      'subscription-contract-pending',
      'Contrato recorrente ainda não foi criado para este evento.'
    );
  }

  const current = existing.data() as PlatformRecurringSubscriptionDoc;
  const amountIntegrity = evaluateRecurringSubscriptionAmountIntegrity({
    contractAmountCents: current.amountCents,
    providerAmountCents: event.amountCents,
  });

  if (amountIntegrity === 'mismatch') {
    await quarantineRecurringSubscriptionAmountMismatch({
      contractId,
      contractRef,
      contract: current,
      event,
      now: Date.now(),
    });
    if (current.status === 'pending_payment') {
      await releasePlatformCheckoutLock({
        buyerUid: current.buyerUid,
        checkoutSessionId: current.sourceCheckoutSessionId,
      }).catch(() => false);
    }
    return 'processed';
  }

  const stateRef = db
    .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
    .doc(current.buyerUid);
  const isTerminal =
    event.eventName === 'SUBSCRIPTION_DELETED' ||
    event.eventName === 'SUBSCRIPTION_INACTIVATED';

  if (!isTerminal && event.eventName !== 'SUBSCRIPTION_UPDATED') {
    return 'ignored';
  }

  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const stateSnapshot = await tx.get(stateRef);
    const state = stateSnapshot.exists
      ? stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
      : null;
    const terminalStatus =
      event.eventName === 'SUBSCRIPTION_DELETED'
        ? 'deleted'
        : event.eventName === 'SUBSCRIPTION_INACTIVATED'
          ? 'canceled'
          : current.status;

    tx.set(
      contractRef,
      {
        status: terminalStatus,
        renewalEnabled: isTerminal ? false : current.renewalEnabled,
        canceledAt: isTerminal ? now : current.canceledAt,
        lastPaymentStatus: event.providerStatus ?? current.lastPaymentStatus,
        updatedAt: now,
      },
      { merge: true }
    );

    if (
      isTerminal &&
      state?.currentContractId === contractId
    ) {
      tx.set(
        stateRef,
        {
          renewalEnabled: false,
          updatedAt: now,
        },
        { merge: true }
      );
    }
  });

  return 'processed';
}


export async function markRecurringSubscriptionPaymentProblem(
  event: VerifiedProviderWebhookEvent
): Promise<void> {
  if (event.resourceType !== 'payment' || !event.subscriptionId) {
    return;
  }

  const contractId = buildRecurringSubscriptionContractId(
    event.subscriptionId
  );
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(contractId);
  const snapshot = await contractRef.get();

  if (!snapshot.exists) {
    throw new RetryableProviderWebhookError(
      'payment-problem-contract-pending',
      'Contrato recorrente ainda não foi conciliado.'
    );
  }

  const current = snapshot.data() as PlatformRecurringSubscriptionDoc;
  const status =
    event.eventName === 'PAYMENT_OVERDUE'
      ? 'past_due'
      : 'payment_failed';

  await contractRef.set(
    {
      status,
      lastPaymentStatus: event.eventName,
      lastPaymentOccurredAt: event.occurredAt,
      updatedAt: Date.now(),
    },
    { merge: true }
  );

  await db.collection('billing_audit').add({
    action: 'recurring_payment_problem',
    buyerUid: current.buyerUid,
    contractId,
    providerSubscriptionId: current.providerSubscriptionId,
    providerPaymentId: event.paymentId,
    providerEventName: event.eventName,
    accessRevoked: false,
    createdAt: Date.now(),
  });
}


export async function recordRecurringPartialRefund(
  event: VerifiedProviderWebhookEvent
): Promise<void> {
  if (
    event.resourceType !== 'payment' ||
    !event.subscriptionId ||
    !event.paymentId
  ) {
    return;
  }

  const contractId = buildRecurringSubscriptionContractId(
    event.subscriptionId
  );
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(contractId);
  const snapshot = await contractRef.get();

  if (!snapshot.exists) {
    throw new RetryableProviderWebhookError(
      'partial-refund-contract-pending',
      'Contrato recorrente ainda não foi conciliado.'
    );
  }

  const contract =
    snapshot.data() as PlatformRecurringSubscriptionDoc;
  const now = Date.now();

  await contractRef.set(
    {
      lastPaymentStatus: event.eventName,
      lastPaymentOccurredAt: event.occurredAt,
      updatedAt: now,
    },
    { merge: true }
  );

  await db.collection('billing_audit').add({
    action: 'recurring_payment_partially_refunded',
    buyerUid: contract.buyerUid,
    contractId,
    providerSubscriptionId: contract.providerSubscriptionId,
    providerPaymentId: event.paymentId,
    accessRevoked: false,
    createdAt: now,
  });
}
