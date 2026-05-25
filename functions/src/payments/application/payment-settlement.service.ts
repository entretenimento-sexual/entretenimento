// functions/src/payments/application/payment-settlement.service.ts
// -----------------------------------------------------------------------------
// PAYMENT SETTLEMENT SERVICE
// -----------------------------------------------------------------------------
//
// Única camada autorizada a converter evento financeiro confirmado em acesso.
//
// Responsabilidade:
// - validar evento confirmado;
// - localizar checkout original;
// - comparar provider, valor, moeda e escopo;
// - garantir idempotência;
// - registrar payment_events;
// - registrar payment_transactions;
// - conceder ou atualizar entitlement;
// - atualizar users/{uid} como projeção privada rápida;
// - atualizar public_profiles/{uid}.role somente quando o plano público mudar;
// - registrar auditoria.
//
// Segurança:
// - nenhuma URL de retorno concede acesso diretamente;
// - nenhum parâmetro do frontend define role, valor ou provider confiável;
// - nenhum evento não verificado gera entitlement;
// - eventos de Emulator somente funcionam no Functions Emulator Runtime;
// - public_profiles nunca é criado parcialmente pelo pagamento.
//
// Observação sobre public_profiles:
// - se o perfil público ainda não existir, o pagamento continua válido;
// - nesse caso, não criamos um documento público incompleto apenas com role;
// - a auditoria registra que a projeção pública estava ausente.
//
// Escopos futuros:
// - creator_subscription, paid_media, paid_live e tip/mimo deverão possuir
//   processadores próprios;
// - nesta fase, apenas platform_subscription concede entitlement.

import { createHash } from 'node:crypto';

import { FieldValue } from 'firebase-admin/firestore';
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
  if (!params.exists) {
    return 'profile_missing';
  }

  if (params.currentRole === params.grantedRole) {
    return 'already_current';
  }

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

  const paymentEventRef = db
    .collection('payment_events')
    .doc(paymentEventId);

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

    const entitlementRef = db
      .collection('entitlements')
      .doc(entitlementId);

    const userRef = db
      .collection('users')
      .doc(checkout.buyerUid);

    const publicProfileRef = db
      .collection('public_profiles')
      .doc(checkout.buyerUid);

    /**
     * Leitura inicial da idempotência.
     *
     * Caso este mesmo evento já tenha sido processado, nenhuma nova escrita
     * será executada, preservando payment_event, transaction, entitlement,
     * auditoria e projeções.
     */
    const existingEventSnap = await tx.get(paymentEventRef);
    const existingEntitlementSnap = await tx.get(entitlementRef);

    const existingEntitlement = existingEntitlementSnap.exists
      ? (existingEntitlementSnap.data() as EntitlementDoc)
      : null;

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
        role: grantedRole,
        accessGranted: existingEntitlement?.active === true,
      };
    }

    /**
     * Um checkout representa uma cobrança específica.
     *
     * Se já foi liquidado por outro evento, não pode ser reutilizado para
     * produzir uma segunda transação ou substituir auditoria.
     *
     * Renovações futuras deverão possuir modelo próprio de subscription/cycle,
     * e não reutilizar o checkout inicial.
     */
    if (checkout.status === 'paid') {
      throw new HttpsError(
        'already-exists',
        'Este checkout já foi liquidado por outro evento financeiro.'
      );
    }

    /**
     * O perfil público é apenas uma projeção visual do benefício.
     *
     * Ele não é fonte financeira e não pode impedir a liquidação de um
     * pagamento válido. Porém, se existir e o papel público mudar, deve ser
     * atualizado atomicamente junto com a concessão do acesso.
     */
    const publicProfileSnap = await tx.get(publicProfileRef);

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

    /**
     * Entitlement determinístico da assinatura principal.
     *
     * Nesta etapa, pagamentos posteriores substituem a projeção ativa do plano
     * atual, mas preservam createdAt/startsAt quando o benefício já existia.
     *
     * O modelo completo de recorrência, renovação, cancelamento e upgrade será
     * tratado futuramente por subscriptions e ciclos de cobrança.
     */
    const entitlementDoc: EntitlementDoc = {
      id: entitlementId,
      buyerUid: checkout.buyerUid,
      sellerUid: null,
      scope: checkout.scope,
      planId: checkout.planSnapshot!.id,
      planKey: checkout.planSnapshot!.key,
      grantedRole,
      active: true,
      startsAt: toExistingNumberOrFallback(
        existingEntitlement?.startsAt,
        now
      ),
      endsAt: null,
      sourceCheckoutSessionId: checkout.id,
      sourcePaymentTransactionId: transactionId,
      createdAt: toExistingNumberOrFallback(
        existingEntitlement?.createdAt,
        now
      ),
      updatedAt: now,
    };

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

    /**
     * Projeção privada de acesso para consumo rápido da interface e guards.
     *
     * A verdade financeira permanece em payment_transactions e entitlements.
     */
    tx.set(
      userRef,
      {
        role: grantedRole,
        tier: grantedRole,
        isSubscriber: true,
        subscriptionStatus: 'active',
        subscriptionScope: checkout.scope,
        lastBillingCheckoutSessionId: checkout.id,
        lastBillingTransactionId: transactionId,
        billingUpdatedAt: now,
      },
      { merge: true }
    );

    /**
     * Projeção pública mínima do plano.
     *
     * Não criamos public_profiles aqui caso ele esteja ausente, pois isso
     * geraria documento incompleto e potencialmente exibível na descoberta.
     *
     * Não atualizamos updatedAt em renovação do mesmo role, pois esse timestamp
     * participa do comportamento de descoberta/ordenação pública.
     */
    if (publicProfileProjectionStatus === 'updated') {
      tx.set(
        publicProfileRef,
        {
          role: grantedRole,
          updatedAt: FieldValue.serverTimestamp(),
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

      /**
       * Mantemos o nome explícito no documento de auditoria para deixar claro
       * que esta informação representa a projeção pública do role no card,
       * enquanto reutilizamos a variável interna já calculada acima.
       */
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
}// linha460