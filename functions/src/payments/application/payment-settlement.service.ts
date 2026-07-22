// functions/src/payments/application/payment-settlement.service.ts
// -----------------------------------------------------------------------------
// PAYMENT SETTLEMENT SERVICE
// -----------------------------------------------------------------------------
// Única camada autorizada a converter evento financeiro confirmado em acesso.
// O entitlement é a verdade financeira; users/public_profiles são projeções.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';

import {
  CheckoutSessionDoc,
  EntitlementDoc,
  PaymentEventDoc,
  PaymentTransactionDoc,
  PlatformRole,
  SettlementResult,
  VerifiedPaymentEvent,
} from '../domain/billing.model';
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
  assertEmulatorPaymentRuntime,
} from '../security/payment-runtime.guard';

type PublicProfileRoleProjectionStatus =
  | 'updated'
  | 'already_current'
  | 'profile_missing';

interface PublicProfileProjectionData {
  role?: unknown;
}

function buildStableDocumentId(prefix: string, rawValue: string): string {
  const digest = createHash('sha256')
    .update(rawValue)
    .digest('hex');

  return `${prefix}_${digest}`;
}

function assertVerifiedEventAllowed(event: VerifiedPaymentEvent): void {
  if (event.verified !== true) {
    throw new HttpsError(
      'permission-denied',
      'Evento financeiro não verificado.'
    );
  }

  if (event.verificationMode === 'emulator') {
    assertEmulatorPaymentRuntime('settle-emulator-payment');
  }
}

function assertCheckoutMatchesEvent(
  checkout: CheckoutSessionDoc,
  event: VerifiedPaymentEvent
): void {
  if (checkout.provider !== event.provider) {
    throw new HttpsError(
      'failed-precondition',
      'Provider do evento não corresponde ao checkout.'
    );
  }

  if (
    checkout.providerSessionId &&
    event.providerSessionId &&
    checkout.providerSessionId !== event.providerSessionId
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Sessão externa do pagamento não corresponde ao checkout.'
    );
  }

  if (checkout.amountCents !== event.amountCents) {
    throw new HttpsError(
      'failed-precondition',
      'Valor confirmado não corresponde ao checkout.'
    );
  }

  if (checkout.currency !== event.currency) {
    throw new HttpsError(
      'failed-precondition',
      'Moeda confirmada não corresponde ao checkout.'
    );
  }
}

function toExistingNumberOrFallback(
  value: unknown,
  fallback: number
): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback;
}

function resolvePublicProfileProjectionStatus(params: {
  exists: boolean;
  currentRole: unknown;
  grantedRole: PlatformRole;
}): PublicProfileRoleProjectionStatus {
  if (!params.exists) return 'profile_missing';
  if (params.currentRole === params.grantedRole) return 'already_current';
  return 'updated';
}

export async function settleVerifiedPaidEvent(
  event: VerifiedPaymentEvent
): Promise<SettlementResult> {
  assertVerifiedEventAllowed(event);

  if (event.financialStatus !== 'paid') {
    throw new HttpsError(
      'failed-precondition',
      'Somente eventos pagos são suportados nesta etapa do settlement.'
    );
  }

  const checkoutRef = db
    .collection('checkout_sessions')
    .doc(event.checkoutSessionId);
  const paymentEventId = buildStableDocumentId(
    'payment_event',
    `${event.provider}:${event.providerEventId}`
  );
  const paymentEventRef = db.collection('payment_events').doc(paymentEventId);
  const transactionId = buildStableDocumentId(
    'payment_transaction',
    `${event.provider}:${event.providerEventId}`
  );
  const transactionRef = db
    .collection('payment_transactions')
    .doc(transactionId);
  const now = Date.now();

  return db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const checkoutSnap = await tx.get(checkoutRef);

    if (!checkoutSnap.exists) {
      throw new HttpsError(
        'not-found',
        'Checkout associado ao pagamento não foi localizado.'
      );
    }

    const checkout = checkoutSnap.data() as CheckoutSessionDoc;
    assertCheckoutMatchesEvent(checkout, event);

    if (checkout.scope !== 'platform_subscription') {
      throw new HttpsError(
        'failed-precondition',
        'Este escopo financeiro ainda não possui processador seguro habilitado.'
      );
    }

    const grantedRole = checkout.planSnapshot?.grantedRole;
    if (!grantedRole) {
      throw new HttpsError(
        'failed-precondition',
        'Checkout sem snapshot confiável do plano.'
      );
    }

    const entitlementId = `platform_subscription_${checkout.buyerUid}`;
    const entitlementRef = db.collection('entitlements').doc(entitlementId);
    const userRef = db.collection('users').doc(checkout.buyerUid);
    const publicProfileRef = db.collection('public_profiles').doc(checkout.buyerUid);

    const existingEventSnap = await tx.get(paymentEventRef);
    const existingEntitlementSnap = await tx.get(entitlementRef);
    const existingEntitlement = existingEntitlementSnap.exists
      ? (existingEntitlementSnap.data() as EntitlementDoc)
      : null;
    const existingStatus = evaluatePlatformSubscriptionEntitlement(
      existingEntitlement,
      checkout.buyerUid,
      now
    );

    if (existingEventSnap.exists) {
      return {
        processed: true,
        idempotent: true,
        checkoutSessionId: checkout.id,
        paymentEventId,
        transactionId,
        entitlementId,
        scope: checkout.scope,
        status: 'paid',
        role: existingStatus.role ?? grantedRole,
        accessGranted: existingStatus.active,
      };
    }

    if (checkout.status === 'paid') {
      throw new HttpsError(
        'already-exists',
        'Este checkout já foi liquidado por outro evento financeiro.'
      );
    }

    const [userSnapshot, publicProfileSnap] = await Promise.all([
      tx.get(userRef),
      tx.get(publicProfileRef),
    ]);
    const publicProfileData = publicProfileSnap.exists
      ? (publicProfileSnap.data() as PublicProfileProjectionData)
      : null;
    const publicProfileProjectionStatus =
      resolvePublicProfileProjectionStatus({
        exists: publicProfileSnap.exists,
        currentRole: publicProfileData?.role,
        grantedRole,
      });

    const paymentEventDoc: PaymentEventDoc = {
      id: paymentEventId,
      provider: event.provider,
      providerEventId: event.providerEventId,
      providerSessionId: event.providerSessionId ?? null,
      checkoutSessionId: checkout.id,
      status: 'paid',
      amountCents: event.amountCents,
      currency: event.currency,
      verified: true,
      verificationMode: event.verificationMode,
      sanitizedPayloadHash: event.sanitizedPayloadHash ?? null,
      processed: true,
      processedAt: now,
      createdAt: event.receivedAt,
    };

    const transactionDoc: PaymentTransactionDoc = {
      id: transactionId,
      checkoutSessionId: checkout.id,
      paymentEventId,
      buyerUid: checkout.buyerUid,
      sellerUid: checkout.sellerUid ?? null,
      scope: checkout.scope,
      provider: event.provider,
      providerSessionId: event.providerSessionId ?? null,
      status: 'paid',
      amountCents: event.amountCents,
      currency: event.currency,
      planId: checkout.planSnapshot!.id,
      planKey: checkout.planSnapshot!.key,
      createdAt: now,
      updatedAt: now,
    };

    const settlementPeriod = resolvePlatformSubscriptionSettlementPeriod(
      existingEntitlement,
      checkout.buyerUid,
      now
    );
    const startsAt = settlementPeriod.startsAt;
    const endsAt = settlementPeriod.endsAt;

    const entitlementDoc: EntitlementDoc = {
      id: entitlementId,
      buyerUid: checkout.buyerUid,
      sellerUid: null,
      scope: checkout.scope,
      planId: checkout.planSnapshot!.id,
      planKey: checkout.planSnapshot!.key,
      grantedRole,
      active: true,
      startsAt,
      endsAt,
      sourceCheckoutSessionId: checkout.id,
      sourcePaymentTransactionId: transactionId,
      createdAt: toExistingNumberOrFallback(
        existingEntitlement?.createdAt,
        now
      ),
      updatedAt: now,
    };

    const entitlementStatus = evaluatePlatformSubscriptionEntitlement(
      entitlementDoc,
      checkout.buyerUid,
      now
    );
    const userProjection = buildPlatformSubscriptionUserProjection(
      entitlementStatus,
      userSnapshot.data()?.['role'],
      now
    );
    const auditRef = db.collection('billing_audit').doc();

    tx.create(paymentEventRef, paymentEventDoc);
    tx.set(transactionRef, transactionDoc, { merge: false });
    tx.set(entitlementRef, entitlementDoc, { merge: true });
    tx.set(
      checkoutRef,
      {
        status: 'paid',
        updatedAt: now,
        statusHistory: [
          ...(checkout.statusHistory ?? []),
          {
            status: 'paid',
            at: now,
            source:
              event.verificationMode === 'emulator'
                ? 'emulator'
                : 'provider',
            eventId: paymentEventId,
          },
        ],
      },
      { merge: true }
    );

    if (userSnapshot.exists) {
      tx.set(
        userRef,
        {
          ...userProjection,
          lastBillingCheckoutSessionId: checkout.id,
          lastBillingTransactionId: transactionId,
        },
        { merge: true }
      );
    }

    if (publicProfileSnap.exists) {
      tx.set(
        publicProfileRef,
        {
          role: resolvePublicPlatformRole(
            entitlementStatus,
            publicProfileData?.role
          ),
          billingProjectionVersion: PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
          billingProjectionUpdatedAt: now,
        },
        { merge: true }
      );
    }

    tx.set(auditRef, {
      action: 'settle_paid_event',
      buyerUid: checkout.buyerUid,
      checkoutSessionId: checkout.id,
      paymentEventId,
      transactionId,
      entitlementId,
      scope: checkout.scope,
      provider: event.provider,
      verificationMode: event.verificationMode,
      amountCents: event.amountCents,
      currency: event.currency,
      subscriptionStartsAt: startsAt,
      subscriptionEndsAt: endsAt,
      subscriptionExtensionBase: settlementPeriod.extensionBase,
      extendedExistingAccess: settlementPeriod.extendedExistingAccess,
      billingProjectionVersion: PLATFORM_SUBSCRIPTION_PROJECTION_VERSION,
      publicProfileRoleProjectionStatus: publicProfileProjectionStatus,
      createdAt: now,
    });

    return {
      processed: true,
      idempotent: false,
      checkoutSessionId: checkout.id,
      paymentEventId,
      transactionId,
      entitlementId,
      scope: checkout.scope,
      status: 'paid',
      role: grantedRole,
      accessGranted: true,
    };
  });
}
