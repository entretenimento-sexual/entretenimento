// functions/src/payments/application/recurring-subscription-integrity.policy.ts
// -----------------------------------------------------------------------------
// RECURRING SUBSCRIPTION INTEGRITY POLICY
// -----------------------------------------------------------------------------
// Eventos de assinatura podem omitir valor, mas quando o provider o informa ele
// precisa coincidir exatamente com o snapshot contratual interno.
// -----------------------------------------------------------------------------

export type RecurringSubscriptionAmountIntegrity =
  | 'verified'
  | 'unavailable'
  | 'mismatch';

export function evaluateRecurringSubscriptionAmountIntegrity(input: {
  readonly contractAmountCents: number;
  readonly providerAmountCents: number | null;
}): RecurringSubscriptionAmountIntegrity {
  if (
    !Number.isInteger(input.contractAmountCents)
    || input.contractAmountCents <= 0
  ) {
    return 'mismatch';
  }

  if (input.providerAmountCents === null) {
    return 'unavailable';
  }

  if (
    !Number.isInteger(input.providerAmountCents)
    || input.providerAmountCents <= 0
  ) {
    return 'mismatch';
  }

  return input.contractAmountCents === input.providerAmountCents
    ? 'verified'
    : 'mismatch';
}
