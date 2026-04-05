//functions\src\payments\application\create-platform-checkout-session.handler.ts
import * as admin from 'firebase-admin';
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
    const provider = new AsaasPaymentProvider();

    const appBaseUrl =
      process.env.APP_BASE_URL?.trim() ||
      'http://localhost:4200';

    const checkout = await provider.createCheckoutSession({
      buyerUid,
      scope: 'platform_subscription',
      planId: plan.id,
      planKey: plan.key,
      amountCents: plan.amountCents,
      currency: 'BRL',
      successUrl: `${appBaseUrl}/conta?billing=success`,
      cancelUrl: `${appBaseUrl}/subscription-plan?billing=cancel`,
      metadata: {
        scope: 'platform_subscription',
        buyerUid,
        planId: plan.id,
        planKey: plan.key,
      },
    });

    const now = Date.now();
    const ref = admin.firestore().collection('checkout_sessions').doc();

    await ref.set({
      id: ref.id,
      buyerUid,
      scope: 'platform_subscription',
      planId: plan.id,
      planKey: plan.key,
      amountCents: plan.amountCents,
      currency: plan.currency,
      provider: checkout.provider,
      providerSessionId: checkout.providerSessionId,
      checkoutUrl: checkout.checkoutUrl,
      status: 'provider_created',
      metadata: {
        scope: 'platform_subscription',
        buyerUid,
        planId: plan.id,
        planKey: plan.key,
      },
      createdAt: now,
      updatedAt: now,
    });

    return checkout;
  });