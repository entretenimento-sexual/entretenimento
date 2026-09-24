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
// - downgrade automático permanece bloqueado enquanto não existir uma operação
//   financeira segura para trocar a recorrência apenas no próximo ciclo;
// - o checkout não confirma pagamento;
// - em cloud, o Asaas real só é liberado quando ASAAS_RECURRING_ENABLED=true;
// - App Check, rate limit e lock por comprador protegem a criação.
//
// Evolução futura:
// - fluxo explícito de mudança futura/repricing com consentimento;
// - ciclos anuais, promoções e novos escopos financeiros.

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
  resolvePlatformCheckoutPriceLockExpiresAt,
} from './platform-checkout-price-lock.policy';

import {
  EmulatorPaymentProvider,
} from '../infrastructure/providers/emulator-payment.provider';
import {
  AsaasPaymentProvider,
} from '../infrastructure/providers/asaas.provider';

import {
  isFunctionsEmulatorRuntime,
  requireSafeEmulatorAppBaseUrl,
} from '../security/payment-runtime.guard';
import {
  ASAAS_API_KEY,
  assertAsaasRecurringCheckoutEnabled,
  resolveAsaasRuntimeConfig,
} from '../config/asaas.config';
import {
  assertCallableAppCheck,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import {
  acquirePlatformCheckoutLock,
  releasePlatformCheckoutLock,
} from './platform-checkout-lock.service';
import {
  buildPlatformSubscriptionProviderReturnUrl,
  normalizePlatformSubscriptionFlowContext,
  platformSubscriptionFlowMetadata,
} from '../domain/platform-subscription-flow.policy';

interface CreatePlatformCheckoutSessionRequest {
  planId?: string;
  planKey?: string;
  expectedAmountCents?: number;
  expectedCurrency?: string;
  expectedInterval?: string;
  expectedCatalogVersion?: number;
  minimumRole?: string;
  returnUrl?: string;
}

function assertDisplayedPlanStillCurrent(
  plan: ReturnType<typeof requirePlatformPlanByKey>,
  request: CreatePlatformCheckoutSessionRequest | undefined
): void {
  const quoteComplete =
    !!request
    && typeof request.expectedAmountCents === 'number'
    && Number.isInteger(request.expectedAmountCents)
    && typeof request.expectedCurrency === 'string'
    && typeof request.expectedInterval === 'string'
    && typeof request.expectedCatalogVersion === 'number'
    && Number.isInteger(request.expectedCatalogVersion);

  if (!quoteComplete) {
    throw new HttpsError(
      'failed-precondition',
      'Recarregue o plano antes de continuar para confirmar o valor vigente.',
      {
        reason: 'plan_quote_required',
        planKey: plan.key,
        catalogVersion: plan.catalogVersion,
      }
    );
  }

  const matches =
    request.expectedAmountCents === plan.amountCents
    && request.expectedCurrency === plan.currency
    && request.expectedInterval === plan.interval
    && request.expectedCatalogVersion === plan.catalogVersion;

  if (matches) return;

  throw new HttpsError(
    'failed-precondition',
    'O catálogo do plano foi atualizado. Recarregue os valores antes de continuar.',
    {
      reason: 'plan_quote_changed',
      planKey: plan.key,
      catalogVersion: plan.catalogVersion,
    }
  );
}

export const createPlatformCheckoutSession =
  onCall<CreatePlatformCheckoutSessionRequest>(
    {
      region: FUNCTIONS_REGION,
      secrets: [ASAAS_API_KEY],
    },
    async (request) => {
      const buyerUid = request.auth?.uid ?? null;

      if (!buyerUid) {
        throw new HttpsError(
          'unauthenticated',
          'Usuário não autenticado.'
        );
      }

      assertCallableAppCheck(request.app);
      assertAsaasRecurringCheckoutEnabled();

      await consumeBackendRateLimitQuota({
        action: 'billing:create-platform-checkout',
        subject: buyerUid,
        config: {
          burstWindowMs: 10 * 60 * 1_000,
          burstMax: 5,
          sustainedWindowMs: 24 * 60 * 60 * 1_000,
          sustainedMax: 20,
        },
        message:
          'Muitas tentativas de checkout foram iniciadas. Tente novamente mais tarde.',
      });

      /**
       * Plano e valor são resolvidos exclusivamente pelo backend.
       * O planId recebido é usado apenas como verificação de consistência,
       * nunca como fonte autônoma de preço ou benefício.
       */
      const plan = requirePlatformPlanByKey(
        request.data?.planKey,
        request.data?.planId
      );
      assertDisplayedPlanStillCurrent(plan, request.data);

      const now = Date.now();
      const planSnapshot = createBillingPlanSnapshot(plan, now);
      const initialExpiresAt = resolvePlatformCheckoutPriceLockExpiresAt({
        createdAt: now,
      });
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

      const emulatorRuntime = isFunctionsEmulatorRuntime();
      const asaasRuntime = resolveAsaasRuntimeConfig();
      const appBaseUrl = emulatorRuntime
        ? requireSafeEmulatorAppBaseUrl(process.env.APP_BASE_URL)
        : asaasRuntime.appBaseUrl;

      const provider = emulatorRuntime
        ? new EmulatorPaymentProvider()
        : new AsaasPaymentProvider({
          runtime: asaasRuntime,
          apiKey: ASAAS_API_KEY.value(),
        });
      const eventSource = emulatorRuntime ? 'emulator' : 'provider';
      const runtimeLabel = emulatorRuntime ? 'emulator' : asaasRuntime.environment;
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
        expiresAt: initialExpiresAt,

        statusHistory: [
          {
            status: 'pending',
            at: now,
            source: eventSource,
            eventId: null,
          },
        ],

        createdAt: now,
        updatedAt: now,

        metadata: {
          runtime: runtimeLabel,
          catalogVersion: planSnapshot.catalogVersion,
          planChangeKind: planChangePolicy.kind,
          priceTreatment: planChangePolicy.priceTreatment,
          periodTreatment: planChangePolicy.periodTreatment,
          accessTreatment: planChangePolicy.accessTreatment,
          prorationSupported: planChangePolicy.prorationSupported,
          ...platformSubscriptionFlowMetadata(flowContext),
        },
      };

      /**
       * O lock impede múltiplas recorrências em criação simultânea para o
       * mesmo usuário e torna a conciliação por customer determinística.
       */
      await acquirePlatformCheckoutLock({
        buyerUid,
        checkoutSessionId: checkoutRef.id,
        expiresAt: initialExpiresAt,
        now,
      });

      /**
       * A sessão interna nasce antes da integração com provider para termos
       * checkoutSessionId canônico e auditável desde o primeiro momento.
       */
      await checkoutRef.set(checkoutSession);

      let createdProviderSessionId: string | null = null;

      try {
        const checkout = await provider.createCheckoutSession({
          checkoutSessionId: checkoutRef.id,

          buyerUid,
          sellerUid: null,

          scope: 'platform_subscription',
          planSnapshot,

          amountCents: planSnapshot.amountCents,
          currency: planSnapshot.currency,
          expiresAt: initialExpiresAt,

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

          expiredUrl: buildPlatformSubscriptionProviderReturnUrl({
            appBaseUrl,
            billing: 'failed',
            checkoutSessionId: checkoutRef.id,
            flowContext,
          }),

          metadata: {
            runtime: runtimeLabel,
            catalogVersion: planSnapshot.catalogVersion,
            planChangeKind: planChangePolicy.kind,
            priceTreatment: planChangePolicy.priceTreatment,
            periodTreatment: planChangePolicy.periodTreatment,
            accessTreatment: planChangePolicy.accessTreatment,
            prorationSupported: planChangePolicy.prorationSupported,
          },
        });

        createdProviderSessionId = checkout.providerSessionId;
        const providerCreatedAt = Date.now();
        const effectiveExpiresAt = resolvePlatformCheckoutPriceLockExpiresAt({
          createdAt: now,
          providerExpiresAt: checkout.expiresAt,
        });

        await checkoutRef.set(
          {
            provider: checkout.provider,
            providerSessionId: checkout.providerSessionId,
            checkoutUrl: checkout.checkoutUrl,
            expiresAt: effectiveExpiresAt,
            status: 'provider_created',
            statusHistory: [
              ...checkoutSession.statusHistory!,
              {
                status: 'provider_created',
                at: providerCreatedAt,
                source: eventSource,
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
          expiresAt: effectiveExpiresAt,
          checkoutSessionId: checkoutRef.id,
        };
      } catch (error: unknown) {
        const failedAt = Date.now();

        await releasePlatformCheckoutLock({
          buyerUid,
          checkoutSessionId: checkoutRef.id,
        }).catch(() => false);

        if (createdProviderSessionId) {
          await provider
            .cancelCheckoutSession(createdProviderSessionId)
            .catch(() => undefined);
        }

        await checkoutRef.set(
          {
            status: 'failed',
            statusHistory: [
              ...checkoutSession.statusHistory!,
              {
                status: 'failed',
                at: failedAt,
                source: eventSource,
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
