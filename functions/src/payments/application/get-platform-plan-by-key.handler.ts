//functions\src\payments\application\get-platform-plan-by-key.handler.ts
import { onCall } from 'firebase-functions/v2/https';

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

interface GetPlatformPlanByKeyRequest {
  key?: string;
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

export const getPlatformPlanByKey = onCall<GetPlatformPlanByKeyRequest>(
  async (request) => {
    const key = String(request.data?.key ?? '')
      .trim()
      .toLowerCase() as PlatformPlanKey;

    if (!key || !(key in PLATFORM_PLANS)) {
      return null;
    }

    return PLATFORM_PLANS[key];
  }
);