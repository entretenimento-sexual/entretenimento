// functions/src/payments/application/create-platform-checkout-session.handler.ts
// -----------------------------------------------------------------------------
// CREATE PLATFORM CHECKOUT SESSION HANDLER
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - receber a intenção autenticada de assinatura da plataforma;
// - validar o plano exclusivamente pelo catálogo backend;
// - validar a mudança contra a assinatura canônica vigente;
// - criar snapshot imutável do preço/benefício selecionado;
// - abrir checkout simulado somente no Functions Emulator;
// - persistir checkout_sessions sem conceder acesso.
//
// Segurança:
// - o frontend nunca informa valor financeiro confiável;
// - o frontend nunca define role concedida;
// - downgrade é bloqueado no backend até existir agendamento de próximo ciclo;
// - o checkout não confirma pagamento;
// - em cloud, esta function falha até existir provider real validado;
// - o provider local não se apresenta como Asaas real.
//
// Evolução futura:
// - selecionar provider real por configuração segura;
// - exigir App Check;
// - aplicar idempotency key por tentativa de criação;
// - implementar downgrade agendado no ciclo seguinte;
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
  evaluatePlatformSubscriptionEntitlement,
} from './platform-subscription-entitlement.service';
import {
  resolvePlatformSubscriptionPlanChangePolicy,
} from './platform-subscription-change.policy';

import {
  EmulatorPaymentProvider,
} from '../infrastructure/providers/emulator-payment.provider';

import {
  assertEmulatorPaymentRuntime,
  requireSafeEmulatorAppBaseUrl,
} from '../security/payment-runtime.guard';
import {
  buildPlatformSubscriptionProviderReturnUrl,
  normalizePlatformSubscriptionFlowContext,
  platformSubscriptionFlowMetadata,
} from '../domain/platform-subscription-flow.policy';

interface CreatePlatformCheckoutSessionRequest {
  planId?: string;
  planKey?: string;
  minimumRole?: string;
  returnUrl?: string;
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
      const entitlementRef = db
        .collection('entitlements')
        .doc(`platform_subscription_${buyerUid}`);
      const entitlementSnapshot = await entitlementRef.get();
      const currentSubscription = evaluatePlatformSubscriptionEntitlement(
        entitlementSnapshot.exists ? entitlementSnapshot.data() : null,
        buyerUid,
        now
      );
      const planChangePolicy = resolvePlatformSubscriptionPlanChangePolicy({
        currentRole: currentSubscription.active
          ? currentSubscription.role
          : null,
        requestedRole: planSnapshot.grantedRole,
      });

      if (!planChangePolicy.allowed) {
        throw new HttpsError(
          'failed-precondition',
          'A redução de plano precisa ser programada para o próximo ciclo e ainda não está disponível.',
          {
            reason: 'downgrade_requires_next_cycle',
            currentRole: planChangePolicy.currentRole,
            requestedRole: planChangePolicy.requestedRole,
          }
        );
      }

      const flowContext = normalizePlatformSubscriptionFlowContext({
        minimumRole: request.data?.minimumRole,
        returnUrl: request.data?.returnUrl,
      });

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
          planChangeKind: planChangePolicy.kind,
          ...platformSubscriptionFlowMetadata(flowContext),
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

          successUrl: buildPlatformSubscriptionProviderReturnUrl({
            appBaseUrl,
            billing: 'success',
            checkoutSessionId: checkoutRef.id,
            flowContext,
          }),

          cancelUrl: buildPlatformSubscriptionProviderReturnUrl({
            appBaseUrl,
            billing: 'cancel',
            checkoutSessionId: checkoutRef.id,
            flowContext,
          }),

          metadata: {
            runtime: 'emulator',
            catalogVersion: planSnapshot.catalogVersion,
            planChangeKind: planChangePolicy.kind,
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
