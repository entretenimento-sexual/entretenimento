// functions/src/payments/application/recurring-platform-subscription-settlement.service.ts
// -----------------------------------------------------------------------------
// RECURRING PLATFORM SUBSCRIPTION SETTLEMENT
// -----------------------------------------------------------------------------
// Converte PAYMENT_CONFIRMED/PAYMENT_RECEIVED de uma assinatura recorrente
// autenticada em período de acesso. A idempotência financeira usa payment.id,
// não o id do webhook, evitando duplicar período quando o mesmo pagamento muda
// de CONFIRMED para RECEIVED.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import type {
  EntitlementDoc,
  PaymentEventDoc,
  PaymentTransactionDoc,
  PlatformRole,
  SettlementResult,
} from '../domain/billing.model';
import type {
  VerifiedProviderWebhookEvent,
} from '../domain/provider-webhook.model';
import type {
  PlatformCheckoutLockDoc,
  PlatformRecurringSubscriptionDoc,
  PlatformRecurringSubscriptionStateDoc,
} from '../domain/platform-recurring-subscription.model';
import {
  evaluatePlatformSubscriptionEntitlement,
  resolvePlatformSubscriptionSettlementPeriod,
} from './platform-subscription-entitlement.service';
import {
  resolvePlatformSubscriptionPlanChangePolicy,
} from './platform-subscription-change.policy';
import {
  PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
  buildPlatformSubscriptionUserProjection,
  resolvePublicPlatformRole,
} from './platform-subscription-projection.service';
import {
  buildPlatformSubscriptionTransitionAuditRecord,
} from './platform-subscription-audit.service';
import {
  PLATFORM_CHECKOUT_LOCK_COLLECTION,
} from './platform-checkout-lock.service';
import {
  PLATFORM_SUBSCRIPTION_COLLECTION,
  PLATFORM_SUBSCRIPTION_STATE_COLLECTION,
  RetryableProviderWebhookError,
  buildRecurringSubscriptionContractId,
} from './platform-recurring-subscription.service';

interface RecurringSettlementResult extends SettlementResult {
  contractId: string;
  supersededContractId: string | null;
  supersededProviderSubscriptionId: string | null;
}

type PublicProfileRoleProjectionStatus =
  | 'updated'
  | 'already_current'
  | 'profile_missing';

function stableId(prefix: string, raw: string): string {
  return `${prefix}_${createHash('sha256').update(raw).digest('hex')}`;
}

function publicProfileProjectionStatus(input: {
  exists: boolean;
  currentRole: unknown;
  grantedRole: PlatformRole;
}): PublicProfileRoleProjectionStatus {
  if (!input.exists) return 'profile_missing';
  return input.currentRole === input.grantedRole
    ? 'already_current'
    : 'updated';
}

function requirePaymentEvent(
  event: VerifiedProviderWebhookEvent
): {
  paymentId: string;
  subscriptionId: string;
  amountCents: number;
} {
  if (
    event.resourceType !== 'payment' ||
    !event.paymentId ||
    !event.subscriptionId ||
    event.amountCents === null
  ) {
    throw new HttpsError(
      'invalid-argument',
      'Evento de cobrança recorrente incompleto.'
    );
  }

  return {
    paymentId: event.paymentId,
    subscriptionId: event.subscriptionId,
    amountCents: event.amountCents,
  };
}

export async function settleRecurringPlatformSubscriptionPayment(
  event: VerifiedProviderWebhookEvent
): Promise<RecurringSettlementResult> {
  const payment = requirePaymentEvent(event);
  const contractId = buildRecurringSubscriptionContractId(
    payment.subscriptionId
  );
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(contractId);
  const paymentEventId = stableId(
    'payment_event',
    `asaas:${payment.paymentId}`
  );
  const paymentEventRef = db
    .collection('payment_events')
    .doc(paymentEventId);
  const transactionId = stableId(
    'payment_transaction',
    `asaas:${payment.paymentId}`
  );
  const transactionRef = db
    .collection('payment_transactions')
    .doc(transactionId);
  const now = Date.now();
  const occurredAt = event.occurredAt || now;

  let releaseLockAfterCommit = false;
  let result!: RecurringSettlementResult;

  await db.runTransaction(async (tx) => {
    const contractSnapshot = await tx.get(contractRef);

    if (!contractSnapshot.exists) {
      throw new RetryableProviderWebhookError(
        'recurring-contract-pending',
        'Contrato recorrente ainda não foi conciliado.'
      );
    }

    const contract =
      contractSnapshot.data() as PlatformRecurringSubscriptionDoc;

    if (contract.provider !== 'asaas') {
      throw new HttpsError(
        'failed-precondition',
        'Contrato recorrente pertence a outro provedor.'
      );
    }

    if (contract.amountCents !== payment.amountCents) {
      throw new HttpsError(
        'failed-precondition',
        'Valor da cobrança recorrente diverge do contrato vigente.',
        {
          reason: 'recurring_amount_mismatch',
          contractId,
        }
      );
    }

    const entitlementId = `platform_subscription_${contract.buyerUid}`;
    const entitlementRef = db.collection('entitlements').doc(entitlementId);
    const stateRef = db
      .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
      .doc(contract.buyerUid);
    const userRef = db.collection('users').doc(contract.buyerUid);
    const publicProfileRef = db
      .collection('public_profiles')
      .doc(contract.buyerUid);
    const checkoutRef = db
      .collection('checkout_sessions')
      .doc(contract.sourceCheckoutSessionId);
    const lockRef = db
      .collection(PLATFORM_CHECKOUT_LOCK_COLLECTION)
      .doc(contract.buyerUid);

    const [
      existingPaymentEvent,
      existingTransaction,
      entitlementSnapshot,
      stateSnapshot,
      userSnapshot,
      publicProfileSnapshot,
      checkoutSnapshot,
      lockSnapshot,
    ] = await Promise.all([
      tx.get(paymentEventRef),
      tx.get(transactionRef),
      tx.get(entitlementRef),
      tx.get(stateRef),
      tx.get(userRef),
      tx.get(publicProfileRef),
      tx.get(checkoutRef),
      tx.get(lockRef),
    ]);

    const existingEntitlement = entitlementSnapshot.exists
      ? entitlementSnapshot.data() as EntitlementDoc
      : null;
    const entitlementAtPayment =
      evaluatePlatformSubscriptionEntitlement(
        existingEntitlement,
        contract.buyerUid,
        occurredAt
      );

    if (existingTransaction.exists || existingPaymentEvent.exists) {
      const transaction = existingTransaction.exists
        ? existingTransaction.data() as PaymentTransactionDoc
        : null;
      const currentPayment =
        existingEntitlement?.sourcePaymentTransactionId === transactionId;
      const restoringChargeback =
        transaction?.status === 'chargeback';

      if (restoringChargeback) {
        const restoredEntitlement =
          currentPayment && existingEntitlement !== null
            ? {
              ...existingEntitlement,
              active: true,
              updatedAt: now,
            } satisfies EntitlementDoc
            : existingEntitlement;
        const restoredStatus = evaluatePlatformSubscriptionEntitlement(
          restoredEntitlement,
          contract.buyerUid,
          now
        );
        const publicData = publicProfileSnapshot.exists
          ? publicProfileSnapshot.data() ?? {}
          : {};

        tx.set(
          transactionRef,
          {
            status: 'paid',
            updatedAt: now,
          },
          { merge: true }
        );
        tx.set(
          paymentEventRef,
          {
            status: 'paid',
            processed: true,
            processedAt: now,
            occurredAt,
          },
          { merge: true }
        );
        if (currentPayment && restoredEntitlement) {
          tx.set(entitlementRef, restoredEntitlement, { merge: true });
        }
        tx.set(
          contractRef,
          {
            lastPaymentStatus: event.eventName,
            lastPaymentOccurredAt: occurredAt,
            updatedAt: now,
          },
          { merge: true }
        );

        if (userSnapshot.exists) {
          tx.set(
            userRef,
            buildPlatformSubscriptionUserProjection(
              restoredStatus,
              userSnapshot.data()?.['role'],
              now
            ),
            { merge: true }
          );
        }

        if (publicProfileSnapshot.exists) {
          tx.set(
            publicProfileRef,
            {
              role: resolvePublicPlatformRole(
                restoredStatus,
                publicData['role']
              ),
              billingProjectionVersion:
                PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
              billingProjectionUpdatedAt: now,
            },
            { merge: true }
          );
        }

        tx.set(db.collection('billing_audit').doc(), {
          action: 'restore_recurring_chargeback_payment',
          buyerUid: contract.buyerUid,
          contractId,
          providerSubscriptionId: contract.providerSubscriptionId,
          providerPaymentId: payment.paymentId,
          transactionId,
          entitlementId,
          restoredOriginalPeriod: currentPayment,
          renewalRestored: false,
          accessRestored: currentPayment && restoredStatus.active,
          createdAt: now,
        });

        result = {
          processed: true,
          idempotent: false,
          checkoutSessionId: contract.sourceCheckoutSessionId,
          paymentEventId,
          transactionId,
          entitlementId,
          scope: 'platform_subscription',
          status: 'paid',
          role: restoredStatus.role ?? contract.grantedRole,
          accessGranted: restoredStatus.active,
          contractId,
          supersededContractId: null,
          supersededProviderSubscriptionId: null,
        };
        return;
      }

      const status = evaluatePlatformSubscriptionEntitlement(
        existingEntitlement,
        contract.buyerUid,
        now
      );

      result = {
        processed: true,
        idempotent: true,
        checkoutSessionId: contract.sourceCheckoutSessionId,
        paymentEventId,
        transactionId,
        entitlementId,
        scope: 'platform_subscription',
        status: 'paid',
        role: status.role ?? contract.grantedRole,
        accessGranted: status.active,
        contractId,
        supersededContractId: null,
        supersededProviderSubscriptionId: null,
      };
      return;
    }

    const state = stateSnapshot.exists
      ? stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
      : null;
    const activatingNewContract = contract.status === 'pending_payment';
    const isCurrentContract =
      state?.currentContractId === contractId ||
      (state === null && contract.isCurrent === true);

    if (!activatingNewContract && !isCurrentContract) {
      const auditRef = db.collection('billing_audit').doc();
      const paymentEventDoc: PaymentEventDoc = {
        id: paymentEventId,
        provider: 'asaas',
        providerEventId: event.providerEventId,
        providerSessionId: payment.subscriptionId,
        providerPaymentId: payment.paymentId,
        providerSubscriptionId: payment.subscriptionId,
        checkoutSessionId: contract.sourceCheckoutSessionId,
        status: 'paid',
        amountCents: payment.amountCents,
        currency: 'BRL',
        verified: true,
        verificationMode: event.verificationMode,
        sanitizedPayloadHash: event.sanitizedPayloadHash,
        processed: true,
        processedAt: now,
        occurredAt,
        createdAt: event.receivedAt,
      };
      const transactionDoc: PaymentTransactionDoc = {
        id: transactionId,
        checkoutSessionId: contract.sourceCheckoutSessionId,
        paymentEventId,
        buyerUid: contract.buyerUid,
        sellerUid: null,
        scope: 'platform_subscription',
        provider: 'asaas',
        providerSessionId: payment.subscriptionId,
        providerPaymentId: payment.paymentId,
        providerSubscriptionId: payment.subscriptionId,
        status: 'paid',
        amountCents: payment.amountCents,
        currency: 'BRL',
        planId: contract.planId,
        planKey: contract.planKey,
        createdAt: now,
        updatedAt: now,
      };

      tx.create(paymentEventRef, paymentEventDoc);
      tx.create(transactionRef, transactionDoc);
      tx.set(
        contractRef,
        {
          needsProviderCancellation: true,
          lastPaymentStatus: event.eventName,
          lastPaymentOccurredAt: occurredAt,
          updatedAt: now,
        },
        { merge: true }
      );
      tx.set(auditRef, {
        action: 'non_current_recurring_charge_detected',
        buyerUid: contract.buyerUid,
        contractId,
        providerSubscriptionId: contract.providerSubscriptionId,
        providerPaymentId: payment.paymentId,
        transactionId,
        amountCents: payment.amountCents,
        currency: 'BRL',
        accessGranted: false,
        createdAt: now,
      });

      result = {
        processed: true,
        idempotent: false,
        checkoutSessionId: contract.sourceCheckoutSessionId,
        paymentEventId,
        transactionId,
        entitlementId,
        scope: 'platform_subscription',
        status: 'paid',
        role: entitlementAtPayment.role,
        accessGranted: false,
        contractId,
        supersededContractId: null,
        supersededProviderSubscriptionId: null,
      };
      return;
    }

    const checkout = checkoutSnapshot.exists
      ? checkoutSnapshot.data() as Record<string, unknown>
      : null;

    if (activatingNewContract) {
      if (!checkout) {
        throw new HttpsError(
          'failed-precondition',
          'Checkout inicial da assinatura recorrente não foi localizado.'
        );
      }

      const checkoutPaidAt =
        typeof checkout['metadata'] === 'object' &&
        checkout['metadata'] !== null
          ? Number(
            (checkout['metadata'] as Record<string, unknown>)['checkoutPaidAt']
          )
          : NaN;
      const expiresAt = Number(checkout['expiresAt']);

      if (
        !Number.isFinite(checkoutPaidAt) ||
        !Number.isFinite(expiresAt)
      ) {
        throw new RetryableProviderWebhookError(
          'checkout-paid-signal-pending',
          'A confirmação do Checkout ainda não foi conciliada.'
        );
      }

      if (checkoutPaidAt > expiresAt) {
        throw new HttpsError(
          'failed-precondition',
          'Checkout recorrente foi concluído após a validade do preço.',
          { reason: 'checkout_price_lock_expired' }
        );
      }
    }

    const planChange = resolvePlatformSubscriptionPlanChangePolicy({
      currentRole: entitlementAtPayment.active
        ? entitlementAtPayment.role
        : null,
      requestedRole: contract.grantedRole,
    });

    if (!planChange.allowed) {
      throw new HttpsError(
        'failed-precondition',
        'Cobrança recorrente tentaria reduzir um benefício ainda vigente.',
        {
          reason: 'recurring_downgrade_blocked',
          contractId,
        }
      );
    }

    const renewalDecision = resolveRecurringRenewalAfterPayment({
      contract,
      activatingNewContract,
    });

    const period = resolvePlatformSubscriptionSettlementPeriod(
      existingEntitlement,
      contract.buyerUid,
      occurredAt
    );
    const entitlementDoc: EntitlementDoc = {
      id: entitlementId,
      buyerUid: contract.buyerUid,
      sellerUid: null,
      scope: 'platform_subscription',
      planId: contract.planId,
      planKey: contract.planKey,
      grantedRole: contract.grantedRole,
      active: true,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      sourceCheckoutSessionId: contract.sourceCheckoutSessionId,
      sourcePaymentTransactionId: transactionId,
      createdAt:
        typeof existingEntitlement?.createdAt === 'number'
          ? existingEntitlement.createdAt
          : now,
      updatedAt: now,
    };

    const paymentEventDoc: PaymentEventDoc = {
      id: paymentEventId,
      provider: 'asaas',
      providerEventId: event.providerEventId,
      providerSessionId: payment.subscriptionId,
      providerPaymentId: payment.paymentId,
      providerSubscriptionId: payment.subscriptionId,
      checkoutSessionId: contract.sourceCheckoutSessionId,
      status: 'paid',
      amountCents: payment.amountCents,
      currency: 'BRL',
      verified: true,
      verificationMode: event.verificationMode,
      sanitizedPayloadHash: event.sanitizedPayloadHash,
      processed: true,
      processedAt: now,
      occurredAt,
      createdAt: event.receivedAt,
    };
    const transactionDoc: PaymentTransactionDoc = {
      id: transactionId,
      checkoutSessionId: contract.sourceCheckoutSessionId,
      paymentEventId,
      buyerUid: contract.buyerUid,
      sellerUid: null,
      scope: 'platform_subscription',
      provider: 'asaas',
      providerSessionId: payment.subscriptionId,
      providerPaymentId: payment.paymentId,
      providerSubscriptionId: payment.subscriptionId,
      status: 'paid',
      amountCents: payment.amountCents,
      currency: 'BRL',
      planId: contract.planId,
      planKey: contract.planKey,
      createdAt: now,
      updatedAt: now,
    };

    let supersededContractId: string | null = null;
    let supersededProviderSubscriptionId: string | null = null;

    if (
      activatingNewContract &&
      state?.currentContractId &&
      state.currentContractId !== contractId
    ) {
      const oldRef = db
        .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
        .doc(state.currentContractId);
      const oldSnapshot = await tx.get(oldRef);

      if (oldSnapshot.exists) {
        const old = oldSnapshot.data() as PlatformRecurringSubscriptionDoc;
        supersededContractId = old.id;
        supersededProviderSubscriptionId = old.providerSubscriptionId;
        tx.set(
          oldRef,
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
    }

    const transitionAudit =
      buildPlatformSubscriptionTransitionAuditRecord({
        buyerUid: contract.buyerUid,
        entitlementId,
        eventId: `recurring_payment:${transactionId}`,
        beforeData:
          existingEntitlement as unknown as Record<string, unknown> | null,
        afterData:
          entitlementDoc as unknown as Record<string, unknown>,
        occurredAt,
        recordedAt: now,
      });
    const transitionAuditRef = transitionAudit
      ? db.collection('billing_audit').doc(transitionAudit.id)
      : null;
    const publicData = publicProfileSnapshot.exists
      ? publicProfileSnapshot.data() ?? {}
      : {};
    const entitlementNow = evaluatePlatformSubscriptionEntitlement(
      entitlementDoc,
      contract.buyerUid,
      now
    );
    const userProjection = buildPlatformSubscriptionUserProjection(
      entitlementNow,
      userSnapshot.data()?.['role'],
      now
    );
    const auditRef = db.collection('billing_audit').doc();

    tx.create(paymentEventRef, paymentEventDoc);
    tx.create(transactionRef, transactionDoc);
    tx.set(entitlementRef, entitlementDoc, { merge: true });

    tx.set(
      contractRef,
      {
        status: renewalDecision.status,
        renewalEnabled: renewalDecision.renewalEnabled,
        isCurrent: true,
        lastSettledProviderPaymentId: payment.paymentId,
        lastPaymentStatus: event.eventName,
        lastPaymentOccurredAt: occurredAt,
        activatedAt: contract.activatedAt ?? now,
        needsProviderCancellation:
          renewalDecision.needsProviderCancellation,
        providerCancellationNextAttemptAt:
          renewalDecision.providerCancellationNextAttemptAt,
        providerCancellationLastErrorCode:
          renewalDecision.providerCancellationLastErrorCode,
        updatedAt: now,
      },
      { merge: true }
    );

    const stateDoc: PlatformRecurringSubscriptionStateDoc = {
      buyerUid: contract.buyerUid,
      currentContractId: contractId,
      currentProviderSubscriptionId: contract.providerSubscriptionId,
      currentPlanKey: contract.planKey,
      renewalEnabled: renewalDecision.renewalEnabled,
      updatedAt: now,
    };
    tx.set(stateRef, stateDoc, { merge: false });

    if (activatingNewContract && checkoutSnapshot.exists) {
      const checkoutData = checkoutSnapshot.data() ?? {};
      tx.set(
        checkoutRef,
        {
          status: 'paid',
          providerSubscriptionId: contract.providerSubscriptionId,
          updatedAt: now,
          statusHistory: [
            ...(Array.isArray(checkoutData['statusHistory'])
              ? checkoutData['statusHistory']
              : []),
            {
              status: 'paid',
              at: occurredAt,
              source: 'provider',
              eventId: paymentEventId,
            },
          ],
        },
        { merge: true }
      );

      if (lockSnapshot.exists) {
        const lock = lockSnapshot.data() as PlatformCheckoutLockDoc;
        if (lock.checkoutSessionId === contract.sourceCheckoutSessionId) {
          tx.delete(lockRef);
          releaseLockAfterCommit = true;
        }
      }
    }

    if (transitionAudit && transitionAuditRef) {
      tx.create(transitionAuditRef, transitionAudit.record);
    }

    if (userSnapshot.exists) {
      tx.set(
        userRef,
        {
          ...userProjection,
          lastBillingCheckoutSessionId: contract.sourceCheckoutSessionId,
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
            entitlementNow,
            publicData['role']
          ),
          billingProjectionVersion:
            PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
          billingProjectionUpdatedAt: now,
        },
        { merge: true }
      );
    }

    tx.set(auditRef, {
      action: 'settle_recurring_platform_subscription_payment',
      buyerUid: contract.buyerUid,
      contractId,
      providerSubscriptionId: contract.providerSubscriptionId,
      providerPaymentId: payment.paymentId,
      paymentEventId,
      transactionId,
      entitlementId,
      sourceCheckoutSessionId: contract.sourceCheckoutSessionId,
      planId: contract.planId,
      planKey: contract.planKey,
      amountCents: payment.amountCents,
      currency: 'BRL',
      catalogVersion: contract.planSnapshot.catalogVersion,
      recurringContractPriceLocked: true,
      renewalEnabledAfterPayment: renewalDecision.renewalEnabled,
      cancellationIntentPreserved:
        renewalDecision.preservedCancellationIntent,
      providerCancellationPending:
        renewalDecision.needsProviderCancellation,
      priceTreatment: 'contract_snapshot_until_explicit_change',
      periodTreatment: 'extend_from_current_end',
      prorationSupported: false,
      paymentOccurredAt: occurredAt,
      subscriptionStartsAt: period.startsAt,
      subscriptionEndsAt: period.endsAt,
      subscriptionExtensionBase: period.extensionBase,
      extendedExistingAccess: period.extendedExistingAccess,
      publicProfileRoleProjectionStatus: publicProfileProjectionStatus({
        exists: publicProfileSnapshot.exists,
        currentRole: publicData['role'],
        grantedRole: contract.grantedRole,
      }),
      createdAt: now,
    });

    result = {
      processed: true,
      idempotent: false,
      checkoutSessionId: contract.sourceCheckoutSessionId,
      paymentEventId,
      transactionId,
      entitlementId,
      scope: 'platform_subscription',
      status: 'paid',
      role: contract.grantedRole,
      accessGranted: entitlementNow.active,
      contractId,
      supersededContractId,
      supersededProviderSubscriptionId,
    };
  });

  void releaseLockAfterCommit;
  return result;
}
