// functions/src/payments/application/platform-subscription-change.policy.ts
// -----------------------------------------------------------------------------
// POLICY DE MUDANÇA DE PLANO
// -----------------------------------------------------------------------------
// Define a semântica financeira/temporal suportada pelo checkout atual.
//
// - nova assinatura: preço vigente do catálogo, um mês a partir do pagamento;
// - renovação: preço vigente do catálogo, estende um mês do término atual;
// - upgrade: preço integral vigente do plano alvo, sem proration, acesso maior
//   após pagamento e extensão de um mês a partir do término já pago;
// - downgrade: bloqueado até existir contratação segura após o ciclo atual.
// -----------------------------------------------------------------------------

import type { PlatformRole } from '../domain/billing.model';

export type PlatformSubscriptionPlanChangeKind =
  | 'new_subscription'
  | 'renewal'
  | 'upgrade'
  | 'downgrade_blocked';

export type PlatformSubscriptionPriceTreatment =
  | 'current_catalog_snapshot_full_period'
  | 'not_available';

export type PlatformSubscriptionPeriodTreatment =
  | 'start_from_payment'
  | 'extend_from_current_end'
  | 'blocked';

export type PlatformSubscriptionAccessTreatment =
  | 'activate_after_payment'
  | 'upgrade_after_payment'
  | 'preserve_current_access'
  | 'blocked';

export interface PlatformSubscriptionPlanChangePolicy {
  allowed: boolean;
  kind: PlatformSubscriptionPlanChangeKind;
  currentRole: PlatformRole | null;
  requestedRole: PlatformRole;
  priceTreatment: PlatformSubscriptionPriceTreatment;
  periodTreatment: PlatformSubscriptionPeriodTreatment;
  accessTreatment: PlatformSubscriptionAccessTreatment;
  prorationSupported: false;
}

const PLATFORM_ROLE_RANK: Readonly<Record<PlatformRole, number>> = Object.freeze({
  basic: 1,
  premium: 2,
  vip: 3,
});

export function shouldBlockDuplicateRecurringCheckout(input: {
  readonly currentRole: PlatformRole | null;
  readonly requestedRole: PlatformRole;
  readonly recurringPlanKey: PlatformRole | null;
  readonly renewalEnabled: boolean;
}): boolean {
  return input.currentRole !== null
    && input.currentRole === input.requestedRole
    && input.recurringPlanKey === input.requestedRole
    && input.renewalEnabled;
}

export function resolvePlatformSubscriptionPlanChangePolicy(params: {
  currentRole: PlatformRole | null;
  requestedRole: PlatformRole;
}): PlatformSubscriptionPlanChangePolicy {
  const { currentRole, requestedRole } = params;

  if (!currentRole) {
    return {
      allowed: true,
      kind: 'new_subscription',
      currentRole,
      requestedRole,
      priceTreatment: 'current_catalog_snapshot_full_period',
      periodTreatment: 'start_from_payment',
      accessTreatment: 'activate_after_payment',
      prorationSupported: false,
    };
  }

  if (currentRole === requestedRole) {
    return {
      allowed: true,
      kind: 'renewal',
      currentRole,
      requestedRole,
      priceTreatment: 'current_catalog_snapshot_full_period',
      periodTreatment: 'extend_from_current_end',
      accessTreatment: 'preserve_current_access',
      prorationSupported: false,
    };
  }

  if (PLATFORM_ROLE_RANK[requestedRole] > PLATFORM_ROLE_RANK[currentRole]) {
    return {
      allowed: true,
      kind: 'upgrade',
      currentRole,
      requestedRole,
      priceTreatment: 'current_catalog_snapshot_full_period',
      periodTreatment: 'extend_from_current_end',
      accessTreatment: 'upgrade_after_payment',
      prorationSupported: false,
    };
  }

  return {
    allowed: false,
    kind: 'downgrade_blocked',
    currentRole,
    requestedRole,
    priceTreatment: 'not_available',
    periodTreatment: 'blocked',
    accessTreatment: 'blocked',
    prorationSupported: false,
  };
}
