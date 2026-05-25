// functions/src/payments/application/create-platform-checkout-session.handler.ts
// -----------------------------------------------------------------------------
// CREATE PLATFORM CHECKOUT SESSION HANDLER
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - receber a intenção autenticada de assinatura da plataforma;
// - validar o plano exclusivamente pelo catálogo backend;
// - criar snapshot imutável do preço/benefício selecionado;
// - abrir checkout simulado somente no Functions Emulator;
// - persistir checkout_sessions sem conceder acesso.
//
// Segurança:
// - o frontend nunca informa valor financeiro confiável;
// - o frontend nunca define role concedida;
// - o checkout não confirma pagamento;
// - em cloud, esta function falha até existir provider real validado;
// - o provider local não se apresenta como Asaas real.
//
// Evolução futura:
// - selecionar provider real por configuração segura;
// - exigir App Check;
// - aplicar idempotency key por tentativa de criação;
// - permitir ciclos anuais, promoções e novos escopos financeiros.

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import { FUNCTIONS_REGION } from '../../config/functions-region';

import {
  CheckoutSessionDoc,
} from '../domain/billing.model';

import {
  createBillingPlanSnapshot,
  requirePlatformPlanByKey,
} from './billing-plan-catalog.service';

import {
  EmulatorPaymentProvider,
} from '../infrastructure/providers/emulator-payment.provider';

import {
  assertEmulatorPaymentRuntime,
  requireSafeEmulatorAppBaseUrl,
} from '../security/payment-runtime.guard';

interface CreatePlatformCheckoutSessionRequest {
  planId?: string;
  planKey?: string;
}

function buildReturnUrl(params: {
  appBaseUrl: string;
  billing: 'success' | 'cancel';
  checkoutSessionId: string;
}): string {
  const url = new URL('/billing/return', params.appBaseUrl);

  url.searchParams.set('billing', params.billing);
  url.searchParams.set('scope', 'platform_subscription');
  url.searchParams.set('checkoutSessionId', params.checkoutSessionId);

  /**
   * Não adicionamos mockProvider na URL.
   *
   * Motivo:
   * - query string pertence ao navegador;
   * - o provider verdadeiro já está persistido no checkout_sessions;
   * - nenhuma informação financeira deve ser confiada com base no retorno
   *   manipulado pelo cliente.
   */
  return url.toString();
}

export const createPlatformCheckoutSession =
  onCall<CreatePlatformCheckoutSessionRequest>(
    { region: FUNCTIONS_REGION },
    async (request) => {
      const buyerUid = request.auth?.uid ?? null;

      if (!buyerUid) {
        throw new HttpsError(
          'unauthenticated',
          'Usuário não autenticado.'
        );
      }

      /**
       * Enquanto não houver gateway real implementado e validado, criação de
       * checkout só pode ocorrer no Functions Emulator.
       *
       * Esta linha deve executar ANTES de qualquer gravação financeira.
       */
      assertEmulatorPaymentRuntime('create-platform-checkout-session');

      /**
       * Plano e valor são resolvidos exclusivamente pelo backend.
       * O planId recebido é usado apenas como verificação de consistência,
       * nunca como fonte autônoma de preço ou benefício.
       */
      const plan = requirePlatformPlanByKey(
        request.data?.planKey,
        request.data?.planId
      );

      const now = Date.now();
      const planSnapshot = createBillingPlanSnapshot(plan, now);

      const appBaseUrl = requireSafeEmulatorAppBaseUrl(
        process.env.APP_BASE_URL
      );

      const provider = new EmulatorPaymentProvider();
      const checkoutRef = db.collection('checkout_sessions').doc();

      const checkoutSession: CheckoutSessionDoc = {
        id: checkoutRef.id,
        buyerUid,
        sellerUid: null,

        scope: 'platform_subscription',

        planId: planSnapshot.id,
        planKey: planSnapshot.key,
        planSnapshot,

        amountCents: planSnapshot.amountCents,
        currency: planSnapshot.currency,

        provider: provider.providerId,
        providerSessionId: null,
        checkoutUrl: null,

        status: 'pending',
        statusHistory: [
          {
            status: 'pending',
            at: now,
            source: 'emulator',
            eventId: null,
          },
        ],

        createdAt: now,
        updatedAt: now,

        metadata: {
          runtime: 'emulator',
          catalogVersion: planSnapshot.catalogVersion,
        },
      };

      /**
       * A sessão interna nasce antes da integração com provider para termos
       * checkoutSessionId canônico e auditável desde o primeiro momento.
       */
      await checkoutRef.set(checkoutSession);

      try {
        const checkout = await provider.createCheckoutSession({
          checkoutSessionId: checkoutRef.id,

          buyerUid,
          sellerUid: null,

          scope: 'platform_subscription',
          planSnapshot,

          amountCents: planSnapshot.amountCents,
          currency: planSnapshot.currency,

          successUrl: buildReturnUrl({
            appBaseUrl,
            billing: 'success',
            checkoutSessionId: checkoutRef.id,
          }),

          cancelUrl: buildReturnUrl({
            appBaseUrl,
            billing: 'cancel',
            checkoutSessionId: checkoutRef.id,
          }),

          metadata: {
            runtime: 'emulator',
            catalogVersion: planSnapshot.catalogVersion,
          },
        });

        const providerCreatedAt = Date.now();

        await checkoutRef.set(
          {
            provider: checkout.provider,
            providerSessionId: checkout.providerSessionId,
            checkoutUrl: checkout.checkoutUrl,
            status: 'provider_created',
            statusHistory: [
              ...checkoutSession.statusHistory!,
              {
                status: 'provider_created',
                at: providerCreatedAt,
                source: 'emulator',
                eventId: null,
              },
            ],
            updatedAt: providerCreatedAt,
          },
          { merge: true }
        );

        return {
          provider: checkout.provider,
          providerSessionId: checkout.providerSessionId,
          checkoutUrl: checkout.checkoutUrl,
          expiresAt: checkout.expiresAt ?? null,
          checkoutSessionId: checkoutRef.id,
        };
      } catch (error: unknown) {
        const failedAt = Date.now();

        await checkoutRef.set(
          {
            status: 'failed',
            statusHistory: [
              ...checkoutSession.statusHistory!,
              {
                status: 'failed',
                at: failedAt,
                source: 'emulator',
                eventId: null,
              },
            ],
            updatedAt: failedAt,
            metadata: {
              ...checkoutSession.metadata,
              failureReason:
                error instanceof Error
                  ? error.message
                  : 'Erro não identificado ao criar checkout local.',
            },
          },
          { merge: true }
        );

        if (error instanceof HttpsError) {
          throw error;
        }

        throw new HttpsError(
          'internal',
          'Não foi possível criar a sessão de checkout.'
        );
      }
    }
  );