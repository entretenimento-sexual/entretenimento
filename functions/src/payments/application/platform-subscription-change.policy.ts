// functions/src/payments/application/platform-subscription-change.policy.ts
// -----------------------------------------------------------------------------
// POLICY DE MUDANÇA DE PLANO
// -----------------------------------------------------------------------------
// Define a semântica suportada pelo checkout atual.
//
// - nova assinatura: permitida;
// - renovação do mesmo plano: permitida no backend;
// - upgrade: permitido e entra em vigor após confirmação financeira;
// - downgrade: bloqueado enquanto não houver agendamento real para o próximo
//   ciclo de cobrança. Isso evita retirar benefício já pago ou cobrar agora por
//   uma redução futura que o backend ainda não sabe programar.
// -----------------------------------------------------------------------------

import type { PlatformRole } from '../domain/billing.model';

export type PlatformSubscriptionPlanChangeKind =
  | 'new_subscription'
  | 'renewal'
  | 'upgrade'
  | 'downgrade_blocked';

export interface PlatformSubscriptionPlanChangePolicy {
  allowed: boolean;
  kind: PlatformSubscriptionPlanChangeKind;
  currentRole: PlatformRole | null;
  requestedRole: PlatformRole;
}

const PLATFORM_ROLE_RANK: Readonly<Record<PlatformRole, number>> = Object.freeze({
  basic: 1,
  premium: 2,
  vip: 3,
});

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
    };
  }

  if (currentRole === requestedRole) {
    return {
      allowed: true,
      kind: 'renewal',
      currentRole,
      requestedRole,
    };
  }

  if (PLATFORM_ROLE_RANK[requestedRole] > PLATFORM_ROLE_RANK[currentRole]) {
    return {
      allowed: true,
      kind: 'upgrade',
      currentRole,
      requestedRole,
    };
  }

  return {
    allowed: false,
    kind: 'downgrade_blocked',
    currentRole,
    requestedRole,
  };
}
