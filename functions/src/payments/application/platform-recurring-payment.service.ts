// functions/src/payments/application/platform-recurring-payment.service.ts
// -----------------------------------------------------------------------------
// PLATFORM RECURRING PAYMENT SERVICE
// -----------------------------------------------------------------------------
// Converte cobranças recorrentes verificadas do provider em período pago.
//
// Invariantes:
// - idempotência financeira é por providerPaymentId, não pelo webhook;
// - cada cobrança paga estende no máximo um período;
// - renovação nunca depende do callback do navegador;
// - reversão da cobrança que sustenta o entitlement atual revoga somente o
//   acesso ainda apoiado por aquela cobrança;
// - chargeback também encerra novas renovações do contrato afetado.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import type {
  CheckoutSessionDoc,
  EntitlementDoc,
  PaymentEventDoc,
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
  evaluatePlatformSubscriptionEntitlement,
  resolvePlatformSubscriptionSettlementPeriod,
} from './platform-subscription-entitlement.service';
import {
  PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
  buildPlatformSubscriptionUserProjection,
  resolvePublicPlatformRole,
} from './platform-subscription-projection.service';
import {
  buildPlatformSubscriptionTransitionAuditRecord,
} from './platform-subscription-audit.service';
import {
  buildRecurringSubscriptionContractId,
  findRecurringContractByProviderSubscriptionId,
  PLATFORM_SUBSCRIPTION_COLLECTION,
  PLATFORM_SUBSCRIPTION_STATE_COLLECTION,
  RetryableProviderWebhookError,
} from './platform-recurring-subscription.service';
import {
  releasePlatformCheckoutLock,
} from './platform-checkout-lock.service';
import {
  isPlatformCheckoutPriceLockActive,
} from './platform-checkout-price-lock.policy';

const PAID_EVENTS = new Set([
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
]);

const FAILED_EVENTS = new Set([
  'PAYMENT_OVERDUE',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
]);

const REFUND_EVENTS = new Set([
  'PAYMENT_REFUNDED',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
]);

const CHARGEBACK_EVENTS = new Set([
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
]);

function stableId(prefix: string, raw: string): string {
  return `${prefix}_${createHash('sha256').update(raw).digest('hex')}`;
}

function recurringTransactionId(paymentId: string): string {
  return stableId('payment_transaction', `asaas:payment:${paymentId}`);
}

function recurringPaymentEventId(paymentId: string): string {
  return stableId('payment_event', `asaas:payment:${paymentId}`);
}

function requirePaymentIdentity(
  event: VerifiedProviderWebhookEvent
): { paymentId: string; subscriptionId: string } {
  if (
    event.resourceType !== 'payment' ||
    !event.paymentId ||
    !event.subscriptionId
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Evento não identifica cobrança recorrente e assinatura.'
    );
  }

  return {
    paymentId: event.paymentId,
    subscriptionId: event.subscriptionId,
  };
}

async function requireRecurringContract(
  subscriptionId: string
): Promise<PlatformRecurringSubscriptionDoc> {
  const contract = await findRecurringContractByProviderSubscriptionId(
    subscriptionId
  );

  if (!contract) {
    throw new RetryableProviderWebhookError(
      'payment-contract-mapping-pending',
      'Contrato recorrente ainda não foi conciliado para esta cobrança.'
    );
  }

  return contract;
}

function assertRecurringAmount(
  event: VerifiedProviderWebhookEvent,
  contract: PlatformRecurringSubscriptionDoc
): number {
  const amountCents = event.amountCents;
  if (
    amountCents === null ||
    amountCents <= 0 ||
    amountCents !== contract.amountCents
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Valor da cobrança recorrente diverge do contrato canônico.'
    );
  }

  return amountCents;
}

export async function settleAsaasRecurringPayment(
  event: VerifiedProviderWebhookEvent
): Promise<'processed' | 'ignored'> {
  if (!PAID_EVENTS.has(event.eventName)) return 'ignored';

  const { paymentId, subscriptionId } = requirePaymentIdentity(event);
  const contract = await requireRecurringContract(subscriptionId);
  const amountCents = assertRecurringAmount(event, contract);

  const contractId = buildRecurringSubscriptionContractId(subscriptionId);
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(contractId);
  const stateRef = db
    .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
    .doc(contract.buyerUid);
  const checkoutRef = db
    .collection('checkout_sessions')
    .doc(contract.sourceCheckoutSessionId);
  const transactionId = recurringTransactionId(paymentId);
  const transactionRef = db
    .collection('payment_transactions')
    .doc(transactionId);
  const paymentEventId = recurringPaymentEventId(paymentId);
  const paymentEventRef = db
    .collection('payment_events')
    .doc(paymentEventId);
  const entitlementId = `platform_subscription_${contract.buyerUid}`;
  const entitlementRef = db.collection('entitlements').doc(entitlementId);
  const userRef = db.collection('users').doc(contract.buyerUid);
  const publicProfileRef = db
    .collection('public_profiles')
    .doc(contract.buyerUid);

  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const [
      transactionSnapshot,
      contractSnapshot,
      stateSnapshot,
      checkoutSnapshot,
      entitlementSnapshot,
      userSnapshot,
      publicProfileSnapshot,
    ] = await Promise.all([
      tx.get(transactionRef),
      tx.get(contractRef),
      tx.get(stateRef),
      tx.get(checkoutRef),
      tx.get(entitlementRef),
      tx.get(userRef),
      tx.get(publicProfileRef),
    ]);

    if (transactionSnapshot.exists) {
      return;
    }

    if (!contractSnapshot.exists) {
      throw new RetryableProviderWebhookError(
        'payment-contract-mapping-pending',
        'Contrato recorrente desapareceu durante o settlement.'
      );
    }

    const currentContract =
      contractSnapshot.data() as PlatformRecurringSubscriptionDoc;
    const checkout = checkoutSnapshot.exists
      ? checkoutSnapshot.data() as CheckoutSessionDoc
      : null;

    if (!checkout || checkout.provider !== 'asaas') {
      throw new HttpsError(
        'failed-precondition',
        'Checkout originário da recorrência não é confiável.'
      );
    }

    if (
      currentContract.lastSettledProviderPaymentId === null &&
      !isPlatformCheckoutPriceLockActive(checkout, event.occurredAt)
    ) {
      throw new HttpsError(
        'failed-precondition',
        'A primeira cobrança ocorreu fora da validade do checkout.'
      );
    }

    const existingEntitlement = entitlementSnapshot.exists
      ? entitlementSnapshot.data() as EntitlementDoc
      : null;
    const existingStatus = evaluatePlatformSubscriptionEntitlement(
      existingEntitlement,
      currentContract.buyerUid,
      event.occurredAt
    );
    const period = resolvePlatformSubscriptionSettlementPeriod(
      existingEntitlement,
      currentContract.buyerUid,
      event.occurredAt
    );

    const entitlementDoc: EntitlementDoc = {
      id: entitlementId,
      buyerUid: currentContract.buyerUid,
      sellerUid: null,
      scope: 'platform_subscription',
      planId: currentContract.planId,
      planKey: currentContract.planKey,
      grantedRole: currentContract.grantedRole,
      active: true,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      sourceCheckoutSessionId: currentContract.sourceCheckoutSessionId,
      sourcePaymentTransactionId: transactionId,
      createdAt:
        typeof existingEntitlement?.createdAt === 'number'
          ? existingEntitlement.createdAt
          : now,
      updatedAt: now,
    };

    const transactionDoc: PaymentTransactionDoc = {
      id: transactionId,
      checkoutSessionId: currentContract.sourceCheckoutSessionId,
      paymentEventId,
      buyerUid: currentContract.buyerUid,
      sellerUid: null,
      scope: 'platform_subscription',
      provider: 'asaas',
      providerSessionId: checkout.providerSessionId ?? null,
      providerPaymentId: paymentId,
      providerSubscriptionId: subscriptionId,
      status: 'paid',
      amountCents,
      currency: 'BRL',
      planId: currentContract.planId,
      planKey: currentContract.planKey,
      createdAt: now,
      updatedAt: now,
    };

    const eventDoc: PaymentEventDoc = {
      id: paymentEventId,
      provider: 'asaas',
      providerEventId: event.providerEventId,
      providerSessionId: checkout.providerSessionId ?? null,
      providerPaymentId: paymentId,
      providerSubscriptionId: subscriptionId,
      checkoutSessionId: currentContract.sourceCheckoutSessionId,
      status: 'paid',
      amountCents,
      currency: 'BRL',
      verified: true,
      verificationMode: event.verificationMode,
      sanitizedPayloadHash: event.sanitizedPayloadHash,
      processed: true,
      processedAt: now,
      occurredAt: event.occurredAt,
      createdAt: event.receivedAt,
    };

    const transitionAudit = buildPlatformSubscriptionTransitionAuditRecord({
      buyerUid: currentContract.buyerUid,
      entitlementId,
      eventId: `payment_settlement:${transactionId}`,
      beforeData:
        existingEntitlement as unknown as Record<string, unknown> | null,
      afterData: entitlementDoc as unknown as Record<string, unknown>,
      occurredAt: now,
      recordedAt: now,
    });

    const state = stateSnapshot.exists
      ? stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
      : null;
    const previousContractId =
      state?.currentContractId &&
      state.currentContractId !== contractId
        ? state.currentContractId
        : null;
    const previousContractRef = previousContractId
      ? db.collection(PLATFORM_SUBSCRIPTION_COLLECTION).doc(previousContractId)
      : null;

    if (previousContractRef) {
      tx.set(
        previousContractRef,
        {
          status: 'superseded',
          renewalEnabled: false,
          isCurrent: false,
          needsProviderCancellation: true,
          providerCancellationNextAttemptAt: now,
          supersededAt: now,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    tx.create(transactionRef, transactionDoc);
    tx.set(paymentEventRef, eventDoc, { merge: false });
    tx.set(entitlementRef, entitlementDoc, { merge: true });

    tx.set(
      contractRef,
      {
        status: 'active',
        renewalEnabled: true,
        isCurrent: true,
        lastSettledProviderPaymentId: paymentId,
        lastPaymentStatus: event.providerStatus ?? event.eventName,
        lastPaymentOccurredAt: event.occurredAt,
        activatedAt: currentContract.activatedAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(
      stateRef,
      {
        buyerUid: currentContract.buyerUid,
        currentContractId: contractId,
        currentProviderSubscriptionId: subscriptionId,
        currentPlanKey: currentContract.planKey,
        renewalEnabled: true,
        updatedAt: now,
      },
      { merge: false }
    );

    tx.set(
      checkoutRef,
      {
        providerSubscriptionId: subscriptionId,
        providerCustomerId:
          currentContract.providerCustomerId ??
          checkout.providerCustomerId ??
          null,
        status: 'paid',
        updatedAt: now,
        statusHistory: [
          ...(checkout.statusHistory ?? []),
          {
            status: 'paid',
            at: event.occurredAt,
            source: 'provider',
            eventId: event.providerEventId,
          },
        ],
      },
      { merge: true }
    );

    if (transitionAudit) {
      tx.set(
        db.collection('billing_audit').doc(transitionAudit.id),
        transitionAudit.record,
        { merge: false }
      );
    }

    const projectedStatus = evaluatePlatformSubscriptionEntitlement(
      entitlementDoc,
      currentContract.buyerUid,
      now
    );

    if (userSnapshot.exists) {
      tx.set(
        userRef,
        {
          ...buildPlatformSubscriptionUserProjection(
            projectedStatus,
            userSnapshot.data()?.['role'],
            now
          ),
          lastBillingCheckoutSessionId:
            currentContract.sourceCheckoutSessionId,
          lastBillingTransactionId: transactionId,
        },
        { merge: true }
      );
    }

    if (publicProfileSnapshot.exists) {
      tx.set(
        publicProfileRef,
        {
          role: resolvePublicPlatformRole(
            projectedStatus,
            publicProfileSnapshot.data()?.['role']
          ),
          billingProjectionVersion:
            PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
          updatedAt: now,
        },
        { merge: true }
      );
    }
  });

  await releasePlatformCheckoutLock({
    buyerUid: contract.buyerUid,
    checkoutSessionId: contract.sourceCheckoutSessionId,
  }).catch(() => false);

  return 'processed';
}

export async function applyAsaasPaymentStatusEvent(
  event: VerifiedProviderWebhookEvent
): Promise<'processed' | 'ignored'> {
  if (PAID_EVENTS.has(event.eventName)) {
    return settleAsaasRecurringPayment(event);
  }

  if (
    !FAILED_EVENTS.has(event.eventName) &&
    !REFUND_EVENTS.has(event.eventName) &&
    !CHARGEBACK_EVENTS.has(event.eventName)
  ) {
    return 'ignored';
  }

  const { paymentId, subscriptionId } = requirePaymentIdentity(event);
  const contract = await requireRecurringContract(subscriptionId);
  const contractId = buildRecurringSubscriptionContractId(subscriptionId);
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(contractId);
  const transactionId = recurringTransactionId(paymentId);
  const transactionRef = db
    .collection('payment_transactions')
    .doc(transactionId);
  const entitlementRef = db
    .collection('entitlements')
    .doc(`platform_subscription_${contract.buyerUid}`);
  const stateRef = db
    .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
    .doc(contract.buyerUid);
  const now = Date.now();

  const isRefund = REFUND_EVENTS.has(event.eventName);
  const isChargeback = CHARGEBACK_EVENTS.has(event.eventName);

  await db.runTransaction(async (tx) => {
    const [
      freshContractSnapshot,
      transactionSnapshot,
      entitlementSnapshot,
      stateSnapshot,
    ] = await Promise.all([
      tx.get(contractRef),
      tx.get(transactionRef),
      tx.get(entitlementRef),
      tx.get(stateRef),
    ]);

    if (!freshContractSnapshot.exists) {
      throw new RetryableProviderWebhookError(
        'payment-contract-mapping-pending',
        'Contrato recorrente indisponível durante atualização financeira.'
      );
    }

    const current =
      freshContractSnapshot.data() as PlatformRecurringSubscriptionDoc;

    tx.set(
      contractRef,
      {
        status:
          isChargeback
            ? 'chargeback'
            : isRefund
              ? current.status
              : event.eventName === 'PAYMENT_OVERDUE'
                ? 'past_due'
                : 'payment_failed',
        renewalEnabled: isChargeback ? false : current.renewalEnabled,
        needsProviderCancellation:
          isChargeback ? true : current.needsProviderCancellation,
        providerCancellationNextAttemptAt:
          isChargeback ? now : current.providerCancellationNextAttemptAt,
        lastPaymentStatus: event.providerStatus ?? event.eventName,
        lastPaymentOccurredAt: event.occurredAt,
        updatedAt: now,
      },
      { merge: true }
    );

    if (transactionSnapshot.exists && (isRefund || isChargeback)) {
      tx.set(
        transactionRef,
        {
          status: isChargeback ? 'chargeback' : 'refunded',
          updatedAt: now,
        },
        { merge: true }
      );
    }

    if (entitlementSnapshot.exists && (isRefund || isChargeback)) {
      const entitlement = entitlementSnapshot.data() as EntitlementDoc;
      if (entitlement.sourcePaymentTransactionId === transactionId) {
        tx.set(
          entitlementRef,
          {
            active: false,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    }

    if (isChargeback && stateSnapshot.exists) {
      const state =
        stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc;
      if (state.currentContractId === contractId) {
        tx.set(
          stateRef,
          {
            renewalEnabled: false,
            updatedAt: now,
          },
          { merge: true }
        );
      }
    }
  });

  return 'processed';
}
