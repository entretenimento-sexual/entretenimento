// functions/src/payments/application/billing-plan-catalog.service.ts
// -----------------------------------------------------------------------------
// BILLING PLAN CATALOG SERVICE
// -----------------------------------------------------------------------------
//
// Catálogo inicial centralizado dos planos da plataforma.
//
// Nesta etapa:
// - permanece em código para reduzir superfície de edição indevida;
// - evita duplicação entre handlers;
// - gera snapshot imutável no momento do checkout.
//
// Evolução futura:
// - catálogo administrável via backoffice;
// - versionamento persistido;
// - promoções/cuponagem;
// - planos anuais e ciclos adicionais.

import { HttpsError } from 'firebase-functions/v2/https';

import {
  BillingPlan,
  BillingPlanSnapshot,
  PlatformPlanKey,
} from '../domain/billing.model';

const PLATFORM_PLANS: Readonly<Record<PlatformPlanKey, BillingPlan>> = {
  basic: {
    id: 'platform_basic_monthly',
    key: 'basic',
    scope: 'platform_subscription',
    title: 'Plano Básico',
    description: 'Entrada inicial para recursos essenciais da plataforma.',
    amountCents: 1999,
    currency: 'BRL',
    interval: 'month',
    active: true,
    grantedRole: 'basic',
    catalogVersion: 1,
  },

  premium: {
    id: 'platform_premium_monthly',
    key: 'premium',
    scope: 'platform_subscription',
    title: 'Plano Premium',
    description: 'Mais benefícios, prioridade e acesso ampliado.',
    amountCents: 2999,
    currency: 'BRL',
    interval: 'month',
    active: true,
    grantedRole: 'premium',
    catalogVersion: 1,
  },

  vip: {
    id: 'platform_vip_monthly',
    key: 'vip',
    scope: 'platform_subscription',
    title: 'Plano Vip',
    description: 'Experiência mais avançada da plataforma.',
    amountCents: 3999,
    currency: 'BRL',
    interval: 'month',
    active: true,
    grantedRole: 'vip',
    catalogVersion: 1,
  },
};

export function normalizePlatformPlanKey(rawValue: unknown): PlatformPlanKey | null {
  const value = String(rawValue ?? '').trim().toLowerCase();

  if (value === 'basic' || value === 'premium' || value === 'vip') {
    return value;
  }

  return null;
}

export function getPlatformPlanByKey(
  rawKey: unknown
): BillingPlan | null {
  const key = normalizePlatformPlanKey(rawKey);

  if (!key) {
    return null;
  }

  const plan = PLATFORM_PLANS[key];

  return plan.active ? { ...plan } : null;
}

export function requirePlatformPlanByKey(
  rawKey: unknown,
  expectedPlanId?: unknown
): BillingPlan {
  const plan = getPlatformPlanByKey(rawKey);

  if (!plan) {
    throw new HttpsError('invalid-argument', 'Plano inválido ou indisponível.');
  }

  const planId = String(expectedPlanId ?? '').trim();

  if (planId && planId !== plan.id) {
    throw new HttpsError(
      'invalid-argument',
      'planId incompatível com o plano selecionado.'
    );
  }

  return plan;
}

export function createBillingPlanSnapshot(
  plan: BillingPlan,
  now = Date.now()
): BillingPlanSnapshot {
  return {
    ...plan,
    snapshotAt: now,
  };
}