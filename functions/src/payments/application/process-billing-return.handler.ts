// functions/src/payments/application/process-billing-return.handler.ts
// -----------------------------------------------------------------------------
// PROCESS BILLING RETURN HANDLER
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - interpretar o retorno visual do checkout para o usuário autenticado;
// - localizar a sessão de checkout pertencente ao próprio usuário;
// - consultar concessão já realizada;
// - em Emulator, permitir confirmação local controlada;
// - em Cloud, jamais confirmar pagamento com base em query string/retorno do
//   navegador.
//
// Regra central de segurança:
// - retorno do navegador NÃO é confirmação financeira;
// - somente VerifiedPaymentEvent processado pelo PaymentSettlementService pode
//   criar transação e entitlement;
// - o modo Emulator existe apenas para desenvolvimento controlado.
//
// Compatibilidade temporária:
// - `mockProvider` permanece no contrato de entrada porque o frontend atual
//   ainda o envia;
// - o campo é deliberadamente ignorado como fonte de verdade;
// - após ajuste do frontend, ele poderá ser removido do contrato.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

import {
  BillingScope,
  CheckoutSessionDoc,
  PlatformRole,
  VerifiedPaymentEvent,
} from '../domain/billing.model';

import {
  settleVerifiedPaidEvent,
} from './payment-settlement.service';

import {
  isFunctionsEmulatorRuntime,
} from '../security/payment-runtime.guard';

type BillingReturnStatus =
  | 'processing'
  | 'granted'
  | 'failed'
  | 'canceled';

interface ProcessBillingReturnRequest {
  billing?: string;
  scope?: string;

  /**
   * Campo legado temporariamente aceito para não quebrar o frontend atual.
   * Não é utilizado para reconhecer pagamento, provider ou permissão.
   */
  mockProvider?: string | null;

  /**
   * Campo legado aceito somente para resposta/compatibilidade.
   * A localização segura da sessão ocorre por checkoutSessionId.
   */
  providerSessionId?: string | null;

  checkoutSessionId?: string | null;
}

interface ProcessBillingReturnResponse {
  status: BillingReturnStatus;
  scope: string;
  role?: PlatformRole | null;
  accessGranted?: boolean;
  checkoutSessionId?: string | null;
  providerSessionId?: string | null;
  redirectTo?: string | null;
  message?: string | null;
}

interface ActiveEntitlementLike {
  active?: boolean;
  grantedRole?: PlatformRole | null;
}

function normalizeBillingSignal(rawValue: unknown):
  | 'success'
  | 'cancel'
  | 'failed'
  | 'unknown' {
  const value = String(rawValue ?? '')
    .trim()
    .toLowerCase()
    .split('?')[0];

  if (value === 'success' || value === 'paid') {
    return 'success';
  }

  if (value === 'cancel' || value === 'canceled' || value === 'cancelled') {
    return 'cancel';
  }

  if (value === 'failed' || value === 'error') {
    return 'failed';
  }

  return 'unknown';
}

function isBillingScope(value: unknown): value is BillingScope {
  return (
    value === 'platform_subscription' ||
    value === 'creator_subscription' ||
    value === 'tip' ||
    value === 'paid_media' ||
    value === 'paid_live'
  );
}

function normalizeCheckoutSessionId(rawValue: unknown): string | null {
  const id = String(rawValue ?? '').trim();

  /**
   * Limite simples para evitar entradas absurdamente extensas em lookup/log.
   * O identificador real do Firestore permanece livre dentro desse limite.
   */
  return id && id.length <= 160 ? id : null;
}

function buildProcessingResult(params: {
  scope: BillingScope;
  checkoutSessionId?: string | null;
  providerSessionId?: string | null;
  message: string;
}): ProcessBillingReturnResponse {
  return {
    status: 'processing',
    scope: params.scope,
    role: null,
    accessGranted: false,
    checkoutSessionId: params.checkoutSessionId ?? null,
    providerSessionId: params.providerSessionId ?? null,
    redirectTo: null,
    message: params.message,
  };
}

function buildGrantedResult(params: {
  scope: BillingScope;
  checkoutSessionId: string;
  providerSessionId?: string | null;
  role?: PlatformRole | null;
  message?: string | null;
}): ProcessBillingReturnResponse {
  return {
    status: 'granted',
    scope: params.scope,
    role: params.role ?? null,
    accessGranted: true,
    checkoutSessionId: params.checkoutSessionId,
    providerSessionId: params.providerSessionId ?? null,
    redirectTo: '/conta',
    message: params.message ?? 'Acesso confirmado com sucesso.',
  };
}

async function findOwnedCheckoutSession(params: {
  buyerUid: string;
  checkoutSessionId: string;
}): Promise<CheckoutSessionDoc | null> {
  const snapshot = await db
    .collection('checkout_sessions')
    .doc(params.checkoutSessionId)
    .get();

  if (!snapshot.exists) {
    return null;
  }

  const data = snapshot.data() as CheckoutSessionDoc | undefined;

  /**
   * Não revelamos se um checkout pertence a outro usuário.
   * Para o chamador, documento inexistente e documento sem propriedade válida
   * produzem o mesmo resultado.
   */
  if (!data || data.buyerUid !== params.buyerUid) {
    return null;
  }

  return data;
}

async function getGrantedEntitlement(
  checkout: CheckoutSessionDoc
): Promise<{
  active: boolean;
  role: PlatformRole | null;
}> {
  if (checkout.scope !== 'platform_subscription') {
    return {
      active: false,
      role: null,
    };
  }

  const entitlementId = `platform_subscription_${checkout.buyerUid}`;

  const entitlementSnapshot = await db
    .collection('entitlements')
    .doc(entitlementId)
    .get();

  const entitlement =
    entitlementSnapshot.data() as ActiveEntitlementLike | undefined;

  return {
    active: entitlement?.active === true,
    role: entitlement?.grantedRole ?? null,
  };
}

async function registerEmulatorVisualCancel(
  checkout: CheckoutSessionDoc
): Promise<void> {
  const now = Date.now();

  await db
    .collection('checkout_sessions')
    .doc(checkout.id)
    .set(
      {
        status: 'canceled',
        updatedAt: now,
        statusHistory: [
          ...(checkout.statusHistory ?? []),
          {
            status: 'canceled',
            at: now,
            source: 'emulator',
            eventId: null,
          },
        ],
      },
      { merge: true }
    );
}

function buildVerifiedEmulatorPaidEvent(
  checkout: CheckoutSessionDoc
): VerifiedPaymentEvent {
  if (checkout.provider !== 'emulator') {
    throw new HttpsError(
      'failed-precondition',
      'Somente checkouts locais podem ser confirmados pelo retorno simulado.'
    );
  }

  if (!checkout.providerSessionId) {
    throw new HttpsError(
      'failed-precondition',
      'Checkout local sem sessão de provider válida.'
    );
  }

  return {
    provider: 'emulator',

    /**
     * Evento determinístico:
     * - múltiplos reloads do retorno geram o mesmo evento;
     * - PaymentSettlementService trata como idempotente.
     */
    providerEventId: `checkout_return_paid_${checkout.id}`,

    providerSessionId: checkout.providerSessionId,
    checkoutSessionId: checkout.id,

    financialStatus: 'paid',

    /**
     * Valor e moeda vêm exclusivamente do checkout persistido pelo backend.
     * Nada financeiro é aceito da URL do navegador.
     */
    amountCents: checkout.amountCents,
    currency: checkout.currency,

    verified: true,
    verificationMode: 'emulator',
    receivedAt: Date.now(),
    sanitizedPayloadHash: null,
  };
}

export const processBillingReturn = onCall<ProcessBillingReturnRequest>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<ProcessBillingReturnResponse> => {
    const buyerUid = request.auth?.uid ?? null;

    if (!buyerUid) {
      throw new HttpsError(
        'unauthenticated',
        'Usuário não autenticado.'
      );
    }

    const requestedScope = String(request.data?.scope ?? '')
      .trim()
      .toLowerCase();

    if (!isBillingScope(requestedScope)) {
      throw new HttpsError(
        'invalid-argument',
        'Escopo de pagamento inválido.'
      );
    }

    const checkoutSessionId = normalizeCheckoutSessionId(
      request.data?.checkoutSessionId
    );

    if (!checkoutSessionId) {
      return buildProcessingResult({
        scope: requestedScope,
        message: 'Sessão de checkout não informada ou ainda indisponível.',
      });
    }

    const checkout = await findOwnedCheckoutSession({
      buyerUid,
      checkoutSessionId,
    });

    if (!checkout) {
      return buildProcessingResult({
        scope: requestedScope,
        checkoutSessionId,
        message: 'Sessão de checkout ainda não localizada.',
      });
    }

    if (checkout.scope !== requestedScope) {
      throw new HttpsError(
        'failed-precondition',
        'O escopo retornado não corresponde ao checkout localizado.'
      );
    }

    const grantedEntitlement = await getGrantedEntitlement(checkout);

    /**
     * Se o settlement já ocorreu, apenas refletimos o estado persistido.
     * Não reprocessamos qualquer sinal do navegador.
     */
    if (checkout.status === 'paid' && grantedEntitlement.active) {
      return buildGrantedResult({
        scope: checkout.scope,
        checkoutSessionId: checkout.id,
        providerSessionId: checkout.providerSessionId ?? null,
        role:
          grantedEntitlement.role ??
          checkout.planSnapshot?.grantedRole ??
          null,
        message: 'Pagamento já confirmado anteriormente.',
      });
    }

    const billingSignal = normalizeBillingSignal(request.data?.billing);

    if (billingSignal === 'cancel') {
      if (isFunctionsEmulatorRuntime()) {
        await registerEmulatorVisualCancel(checkout);
      }

      return {
        status: 'canceled',
        scope: checkout.scope,
        role: null,
        accessGranted: false,
        checkoutSessionId: checkout.id,
        providerSessionId: checkout.providerSessionId ?? null,
        redirectTo: null,
        message: 'Checkout cancelado.',
      };
    }

    if (billingSignal === 'failed') {
      return {
        status: 'failed',
        scope: checkout.scope,
        role: null,
        accessGranted: false,
        checkoutSessionId: checkout.id,
        providerSessionId: checkout.providerSessionId ?? null,
        redirectTo: null,
        message: 'O pagamento não foi confirmado.',
      };
    }

    if (billingSignal !== 'success') {
      return buildProcessingResult({
        scope: checkout.scope,
        checkoutSessionId: checkout.id,
        providerSessionId: checkout.providerSessionId ?? null,
        message: 'Pagamento em processamento.',
      });
    }

    /**
     * Em cloud, retorno do navegador jamais confirma pagamento.
     *
     * Futuramente, o webhook validado do gateway chamará o settlement.
     */
    if (!isFunctionsEmulatorRuntime()) {
      return buildProcessingResult({
        scope: checkout.scope,
        checkoutSessionId: checkout.id,
        providerSessionId: checkout.providerSessionId ?? null,
        message: 'Aguardando confirmação segura do provedor de pagamento.',
      });
    }

    /**
     * Única exceção controlada:
     * - Functions Emulator;
     * - checkout criado pelo EmulatorPaymentProvider;
     * - evento financeiro montado a partir de dados persistidos pelo backend;
     * - settlement idempotente.
     */
    const settlement = await settleVerifiedPaidEvent(
      buildVerifiedEmulatorPaidEvent(checkout)
    );

    return buildGrantedResult({
      scope: checkout.scope,
      checkoutSessionId: checkout.id,
      providerSessionId: checkout.providerSessionId ?? null,
      role: settlement.role ?? null,
      message: settlement.idempotent
        ? 'Assinatura local já havia sido confirmada.'
        : 'Assinatura local confirmada no ambiente de testes.',
    });
  }
);