// scripts/quality/platform-pricing-calibration.mjs
// Offline evaluator for pricing calibration evidence.
// This belongs to the operational/quality layer, not deployable Functions.

export function evaluatePlatformPricingCalibration(input) {
  const count = (value) =>
    Number.isInteger(value) && value >= 0 ? value : null;
  const money = count;

  const observedDays = count(input.observedDays);
  const offersPresented = count(input.offersPresented);
  const paidConversions = count(input.paidConversions);
  const renewalSettlements = count(input.renewalSettlements);
  const cancellations = count(input.cancellations);
  const realizedRevenueCents = money(input.realizedRevenueCents);
  const actualAttributedCostCents = money(input.actualAttributedCostCents);

  let status = 'observed';

  if (
    observedDays === null
    || offersPresented === null
    || paidConversions === null
    || renewalSettlements === null
    || cancellations === null
    || paidConversions > offersPresented
  ) {
    status = 'invalid_observation';
  } else if (observedDays < 14) {
    status = 'window_too_short';
  } else if (offersPresented === 0) {
    status = 'no_offer_observation';
  } else if (paidConversions === 0) {
    status = 'no_paid_conversion_observation';
  } else if (renewalSettlements === 0) {
    status = 'no_renewal_observation';
  } else if (
    realizedRevenueCents === null
    || actualAttributedCostCents === null
  ) {
    status = 'financial_actuals_missing';
  } else if (
    input.financialActualsSource !== 'payment_settlement_actuals'
    && input.financialActualsSource !== 'finance_actual_allocation'
  ) {
    status = 'financial_source_invalid';
  } else if (input.operationalBaselineReady !== true) {
    status = 'operational_baseline_not_ready';
  }

  const ratio = (numerator, denominator) =>
    denominator > 0
      ? Math.round((numerator / denominator) * 10_000) / 10_000
      : null;
  const perUnit = (total, units) =>
    total !== null && units > 0
      ? Math.round((total / units) * 100) / 100
      : null;
  const safeOffers = offersPresented ?? 0;
  const safePaid = paidConversions ?? 0;
  const safeRenewals = renewalSettlements ?? 0;
  const safeCancellations = cancellations ?? 0;
  const reviewEligible = status === 'observed';

  return Object.freeze({
    observedDays: observedDays ?? 0,
    offersPresented: safeOffers,
    paidConversions: safePaid,
    renewalSettlements: safeRenewals,
    cancellations: safeCancellations,
    realizedRevenueCents,
    actualAttributedCostCents,
    paidConversionRate: ratio(safePaid, safeOffers),
    renewalToPaidConversionRate: ratio(safeRenewals, safePaid),
    cancellationToPaidConversionRate: ratio(safeCancellations, safePaid),
    realizedRevenuePerPaidConversionCents:
      perUnit(realizedRevenueCents, safePaid),
    attributedCostPerPaidConversionCents:
      perUnit(actualAttributedCostCents, safePaid),
    status,
    reviewEligible,
    canChangePrice:
      reviewEligible && input.calibrationStage === 'CALIBRATION_ALLOWED',
  });
}
