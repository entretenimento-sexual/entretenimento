//functions\src\payments\application\create-platform-checkout-session.handler.ts
// Não esqueça os comentários explicativos
import { db } from '../../firebaseApp';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { AsaasPaymentProvider } from '../infrastructure/providers/asaas.provider';

type PlatformPlanKey = 'basic' | 'premium' | 'vip';

interface BillingPlan {
  id: string;
  key: PlatformPlanKey;
  scope: 'platform';
  title: string;
  description: string;
  amountCents: number;
  currency: 'BRL';
  interval: 'month';
  active: boolean;
}

interface CreatePlatformCheckoutSessionRequest {
  planId?: string;
  planKey?: string;
}

const PLATFORM_PLANS: Record<PlatformPlanKey, BillingPlan> = {
  basic: {
    id: 'platform_basic_monthly',
    key: 'basic',
    scope: 'platform',
    title: 'Plano Básico',
    description: 'Entrada inicial para recursos essenciais da plataforma.',
    amountCents: 1999,
    currency: 'BRL',
    interval: 'month',
    active: true,
  },
  premium: {
    id: 'platform_premium_monthly',
    key: 'premium',
    scope: 'platform',
    title: 'Plano Premium',
    description: 'Mais benefícios, prioridade e acesso ampliado.',
    amountCents: 2999,
    currency: 'BRL',
    interval: 'month',
    active: true,
  },
  vip: {
    id: 'platform_vip_monthly',
    key: 'vip',
    scope: 'platform',
    title: 'Plano Vip',
    description: 'Experiência mais avançada da plataforma.',
    amountCents: 3999,
    currency: 'BRL',
    interval: 'month',
    active: true,
  },
};

function buildReturnUrl(params: {
  appBaseUrl: string;
  billing: 'success' | 'cancel';
  scope: 'platform_subscription';
  checkoutSessionId: string;
  provider?: string;
}): string {
  const url = new URL('/billing/return', params.appBaseUrl);

  url.searchParams.set('billing', params.billing);
  url.searchParams.set('scope', params.scope);
  url.searchParams.set('checkoutSessionId', params.checkoutSessionId);

  if (params.provider) {
    url.searchParams.set('mockProvider', params.provider);
  }

  return url.toString();
}

export const createPlatformCheckoutSession =
  onCall<CreatePlatformCheckoutSessionRequest>(async (request) => {
    const buyerUid = request.auth?.uid ?? null;

    if (!buyerUid) {
      throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
    }

    const planKey = String(request.data?.planKey ?? '')
      .trim()
      .toLowerCase() as PlatformPlanKey;

    if (!planKey || !(planKey in PLATFORM_PLANS)) {
      throw new HttpsError('invalid-argument', 'Plano inválido.');
    }

    const plan = PLATFORM_PLANS[planKey];

    if (request.data?.planId && request.data.planId !== plan.id) {
      throw new HttpsError(
        'invalid-argument',
        'planId incompatível com o planKey informado.'
      );
    }

    const provider = new AsaasPaymentProvider();

    const appBaseUrl =
      process.env.APP_BASE_URL?.trim() ||
      'http://localhost:4200';

    const now = Date.now();
    const ref = db.collection('checkout_sessions').doc();

    // Criamos a sessão local ANTES de chamar o provider
    // para já ter checkoutSessionId canônico no retorno.
    await ref.set({
      id: ref.id,
      buyerUid,
      scope: 'platform_subscription',
      planId: plan.id,
      planKey: plan.key,
      amountCents: plan.amountCents,
      currency: plan.currency,
      provider: 'asaas',
      providerSessionId: null,
      checkoutUrl: null,
      status: 'pending',
      metadata: {
        scope: 'platform_subscription',
        buyerUid,
        planId: plan.id,
        planKey: plan.key,
        checkoutSessionId: ref.id,
      },
      createdAt: now,
      updatedAt: now,
    });

    try {
      const checkout = await provider.createCheckoutSession({
        buyerUid,
        scope: 'platform_subscription',
        planId: plan.id,
        planKey: plan.key,
        amountCents: plan.amountCents,
        currency: 'BRL',
        successUrl: buildReturnUrl({
          appBaseUrl,
          billing: 'success',
          scope: 'platform_subscription',
          checkoutSessionId: ref.id,
          provider: 'asaas',
        }),
        cancelUrl: buildReturnUrl({
          appBaseUrl,
          billing: 'cancel',
          scope: 'platform_subscription',
          checkoutSessionId: ref.id,
          provider: 'asaas',
        }),
        metadata: {
          scope: 'platform_subscription',
          buyerUid,
          planId: plan.id,
          planKey: plan.key,
          checkoutSessionId: ref.id,
        },
      });

      await ref.set(
        {
          provider: checkout.provider,
          providerSessionId: checkout.providerSessionId,
          checkoutUrl: checkout.checkoutUrl,
          status: 'provider_created',
          updatedAt: Date.now(),
        },
        { merge: true }
      );

      return {
        ...checkout,
        checkoutSessionId: ref.id,
      };
    } catch (error) {
      await ref.set(
        {
          status: 'failed',
          updatedAt: Date.now(),
          metadata: {
            scope: 'platform_subscription',
            buyerUid,
            planId: plan.id,
            planKey: plan.key,
            checkoutSessionId: ref.id,
            errorMessage:
              error instanceof Error ? error.message : String(error),
          },
        },
        { merge: true }
      );

      throw new HttpsError(
        'internal',
        'Não foi possível criar a sessão de checkout.'
      );
    }
  });