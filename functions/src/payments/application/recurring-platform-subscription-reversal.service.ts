// functions/src/payments/application/recurring-platform-subscription-reversal.service.ts
// -----------------------------------------------------------------------------
// RECURRING SUBSCRIPTION REVERSAL
// -----------------------------------------------------------------------------
// Reverte o período somente quando o pagamento estornado/chargeback ainda é a
// fonte do entitlement atual. Eventos de pagamentos antigos nunca apagam um
// período posterior já quitado.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import type {
  EntitlementDoc,
  PaymentTransactionDoc,
} from '../domain/billing.model';
import type {
  VerifiedProviderWebhookEvent,
} from '../domain/provider-webhook.model';
import type {
  PlatformRecurringSubscriptionDoc,
  PlatformRecurringSubscriptionStateDoc,
} from '../domain/platform-recurring-subscription.model';
import {
  reconcilePlatformSubscriptionAccess,
} from './platform-subscription-projection.service';
import {
  PLATFORM_SUBSCRIPTION_COLLECTION,
  PLATFORM_SUBSCRIPTION_STATE_COLLECTION,
  RetryableProviderWebhookError,
  buildRecurringSubscriptionContractId,
} from './platform-recurring-subscription.service';

function stableId(prefix: string, raw: string): string {
  return `${prefix}_${createHash('sha256').update(raw).digest('hex')}`;
}

export async function reverseRecurringPlatformSubscriptionPayment(
  event: VerifiedProviderWebhookEvent
): Promise<{
  processed: boolean;
  idempotent: boolean;
  accessRevoked: boolean;
  providerCancellationRequired: boolean;
}> {
  if (
    event.resourceType !== 'payment' ||
    !event.paymentId ||
    !event.subscriptionId
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Evento reverso sem pagamento ou assinatura.'
    );
  }

  const transactionId = stableId(
    'payment_transaction',
    `asaas:${event.paymentId}`
  );
  const paymentEventId = stableId(
    'payment_event',
    `asaas:${event.paymentId}`
  );
  const contractId = buildRecurringSubscriptionContractId(
    event.subscriptionId
  );
  const transactionRef = db
    .collection('payment_transactions')
    .doc(transactionId);
  const paymentEventRef = db
    .collection('payment_events')
    .doc(paymentEventId);
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(contractId);
  const reversalStatus =
    event.eventName === 'PAYMENT_CHARGEBACK_REQUESTED'
      ? 'chargeback'
      : 'refunded';
  const now = Date.now();

  let buyerUid: string | null = null;
  let accessRevoked = false;
  let providerCancellationRequired = false;
  let idempotent = false;

  await db.runTransaction(async (tx) => {
    const [transactionSnapshot, contractSnapshot] = await Promise.all([
      tx.get(transactionRef),
      tx.get(contractRef),
    ]);

    if (!transactionSnapshot.exists) {
      throw new RetryableProviderWebhookError(
        'payment-reversal-settlement-pending',
        'Pagamento original ainda não foi conciliado.'
      );
    }

    if (!contractSnapshot.exists) {
      throw new RetryableProviderWebhookError(
        'payment-reversal-contract-pending',
        'Contrato recorrente ainda não foi conciliado.'
      );
    }

    const transaction =
      transactionSnapshot.data() as PaymentTransactionDoc;
    const contract =
      contractSnapshot.data() as PlatformRecurringSubscriptionDoc;
    buyerUid = contract.buyerUid;

    if (
      transaction.status === 'refunded' ||
      transaction.status === 'chargeback'
    ) {
      idempotent = true;
      return;
    }

    const entitlementRef = db
      .collection('entitlements')
      .doc(`platform_subscription_${contract.buyerUid}`);
    const stateRef = db
      .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
      .doc(contract.buyerUid);
    const [entitlementSnapshot, stateSnapshot] = await Promise.all([
      tx.get(entitlementRef),
      tx.get(stateRef),
    ]);
    const entitlement = entitlementSnapshot.exists
      ? entitlementSnapshot.data() as EntitlementDoc
      : null;
    const state = stateSnapshot.exists
      ? stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
      : null;
    const currentPayment =
      entitlement?.sourcePaymentTransactionId === transactionId;

    tx.set(
      transactionRef,
      {
        status: reversalStatus,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(
      paymentEventRef,
      {
        status: reversalStatus,
        processed: true,
        processedAt: now,
      },
      { merge: true }
    );

    if (currentPayment && entitlementSnapshot.exists) {
      tx.set(
        entitlementRef,
        {
          active: false,
          endsAt: Math.min(
            typeof entitlement?.endsAt === 'number'
              ? entitlement.endsAt
              : now,
            now
          ),
          updatedAt: now,
        },
        { merge: true }
      );
      accessRevoked = true;
    }

    if (reversalStatus === 'chargeback') {
      providerCancellationRequired = true;
      tx.set(
        contractRef,
        {
          status: 'chargeback',
          renewalEnabled: false,
          needsProviderCancellation: true,
          providerCancellationNextAttemptAt: now,
          lastPaymentStatus: event.eventName,
          lastPaymentOccurredAt: event.occurredAt,
          updatedAt: now,
        },
        { merge: true }
      );

      if (state?.currentContractId === contractId) {
        tx.set(
          stateRef,
          {
            renewalEnabled: false,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    } else {
      tx.set(
        contractRef,
        {
          lastPaymentStatus: event.eventName,
          lastPaymentOccurredAt: event.occurredAt,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    tx.set(db.collection('billing_audit').doc(), {
      action: 'reverse_recurring_platform_subscription_payment',
      buyerUid: contract.buyerUid,
      contractId,
      providerSubscriptionId: contract.providerSubscriptionId,
      providerPaymentId: event.paymentId,
      transactionId,
      reversalStatus,
      accessRevoked: currentPayment,
      providerCancellationRequired:
        reversalStatus === 'chargeback',
      createdAt: now,
    });
  });

  if (buyerUid && accessRevoked) {
    await reconcilePlatformSubscriptionAccess(buyerUid);
  }

  return {
    processed: true,
    idempotent,
    accessRevoked,
    providerCancellationRequired,
  };
}
