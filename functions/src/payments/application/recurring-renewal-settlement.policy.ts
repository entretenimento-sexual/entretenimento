// functions/src/payments/application/recurring-renewal-settlement.policy.ts
// -----------------------------------------------------------------------------
// RECURRING RENEWAL SETTLEMENT POLICY
// -----------------------------------------------------------------------------
// Um pagamento confirmado concede o período pago, mas nunca desfaz uma intenção
// anterior de cancelamento. Renovação só nasce automaticamente na ativação do
// novo contrato ou permanece ativa quando já estava ativa.
// -----------------------------------------------------------------------------

import type {
  PlatformRecurringSubscriptionDoc,
  PlatformRecurringSubscriptionStatus,
} from '../domain/platform-recurring-subscription.model';

export interface RecurringRenewalSettlementDecision {
  readonly status: PlatformRecurringSubscriptionStatus;
  readonly renewalEnabled: boolean;
  readonly needsProviderCancellation: boolean;
  readonly providerCancellationNextAttemptAt: number | null;
  readonly providerCancellationLastErrorCode: string | null;
  readonly preservedCancellationIntent: boolean;
}

const TERMINAL_RENEWAL_STATUSES: ReadonlySet<
  PlatformRecurringSubscriptionStatus
> = new Set([
  'canceled',
  'deleted',
  'superseded',
  'chargeback',
]);

export function resolveRecurringRenewalAfterPayment(input: {
  readonly contract: Pick<
    PlatformRecurringSubscriptionDoc,
    | 'status'
    | 'renewalEnabled'
    | 'needsProviderCancellation'
    | 'providerCancellationNextAttemptAt'
    | 'providerCancellationLastErrorCode'
  >;
  readonly activatingNewContract: boolean;
}): RecurringRenewalSettlementDecision {
  if (input.activatingNewContract) {
    return {
      status: 'active',
      renewalEnabled: true,
      needsProviderCancellation: false,
      providerCancellationNextAttemptAt: null,
      providerCancellationLastErrorCode: null,
      preservedCancellationIntent: false,
    };
  }

  const preserveCancellationIntent =
    input.contract.renewalEnabled !== true
    || input.contract.needsProviderCancellation === true;

  if (!preserveCancellationIntent) {
    return {
      status: 'active',
      renewalEnabled: true,
      needsProviderCancellation: false,
      providerCancellationNextAttemptAt: null,
      providerCancellationLastErrorCode: null,
      preservedCancellationIntent: false,
    };
  }

  return {
    status: TERMINAL_RENEWAL_STATUSES.has(input.contract.status)
      ? input.contract.status
      : 'active',
    renewalEnabled: false,
    needsProviderCancellation:
      input.contract.needsProviderCancellation === true,
    providerCancellationNextAttemptAt:
      input.contract.needsProviderCancellation === true
        ? input.contract.providerCancellationNextAttemptAt
        : null,
    providerCancellationLastErrorCode:
      input.contract.needsProviderCancellation === true
        ? input.contract.providerCancellationLastErrorCode
        : null,
    preservedCancellationIntent: true,
  };
}
