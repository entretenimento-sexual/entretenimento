// functions/src/payments/application/platform-pricing-calibration.policy.ts
// -----------------------------------------------------------------------------
// PLATFORM PRICING CALIBRATION
// -----------------------------------------------------------------------------
// Preço só pode ser discutido com observações financeiras reais.
//
// Esta policy:
// - não sugere preço;
// - não altera catálogo;
// - rejeita proxies operacionais como dinheiro;
// - exige janela de produção + conversão paga + renovação real + custo realizado;
// - permite readiness para revisão, mas alteração continua bloqueada em
//   PRODUCT_CALIBRATION_STAGE=OBSERVE_ONLY.
// -----------------------------------------------------------------------------

import {
  PRODUCT_CALIBRATION_REQUIRED_EVIDENCE,
  isProductCalibrationChangeAllowed,
} from '../../shared/calibration/product-calibration-stage.policy';
import {
  evaluateCommunityOperationalCostBaseline,
  type CommunityOperationalCostBaselineInput,
} from '../../shared/observability/operational-cost-baseline.policy';

export type PlatformPricingCalibrationStatus =
  | 'invalid_observation'
  | 'window_too_short'
  | 'no_offer_observation'
  | 'no_paid_conversion_observation'
  | 'no_renewal_observation'
  | 'financial_actuals_missing'
  | 'financial_source_invalid'
  | 'operational_baseline_not_ready'
  | 'observed';

export interface PlatformPricingCalibrationInput {
  readonly observedDays: unknown;
  readonly offersPresented: unknown;
  readonly paidConversions: unknown;
  readonly renewalSettlements: unknown;
  readonly cancellations: unknown;
  readonly realizedRevenueCents: unknown;
  readonly actualAttributedCostCents: unknown;
  readonly financialActualsSource: unknown;
  readonly operationalBaseline: CommunityOperationalCostBaselineInput;
}

export interface PlatformPricingCalibrationSnapshot {
  readonly observedDays: number;
  readonly offersPresented: number;
  readonly paidConversions: number;
  readonly renewalSettlements: number;
  readonly cancellations: number;
  readonly realizedRevenueCents: number | null;
  readonly actualAttributedCostCents: number | null;
  readonly paidConversionRate: number | null;
  readonly renewalToPaidConversionRate: number | null;
  readonly cancellationToPaidConversionRate: number | null;
  readonly realizedRevenuePerPaidConversionCents: number | null;
  readonly attributedCostPerPaidConversionCents: number | null;
  readonly status: PlatformPricingCalibrationStatus;
  readonly reviewEligible: boolean;
  readonly canChangePrice: boolean;
}

function count(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    ? value
    : null;
}

function money(value: unknown): number | null {
  return count(value);
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

function perUnit(total: number | null, countValue: number): number | null {
  if (total === null || countValue <= 0) return null;
  return Math.round((total / countValue) * 100) / 100;
}

export function evaluatePlatformPricingCalibration(
  input: Readonly<PlatformPricingCalibrationInput>
): Readonly<PlatformPricingCalibrationSnapshot> {
  const observedDays = count(input.observedDays);
  const offersPresented = count(input.offersPresented);
  const paidConversions = count(input.paidConversions);
  const renewalSettlements = count(input.renewalSettlements);
  const cancellations = count(input.cancellations);
  const realizedRevenueCents = money(input.realizedRevenueCents);
  const actualAttributedCostCents = money(input.actualAttributedCostCents);

  const normalized = {
    observedDays: observedDays ?? 0,
    offersPresented: offersPresented ?? 0,
    paidConversions: paidConversions ?? 0,
    renewalSettlements: renewalSettlements ?? 0,
    cancellations: cancellations ?? 0,
  };

  let status: PlatformPricingCalibrationStatus;

  if (
    observedDays === null
    || offersPresented === null
    || paidConversions === null
    || renewalSettlements === null
    || cancellations === null
    || paidConversions > offersPresented
  ) {
    status = 'invalid_observation';
  } else if (
    observedDays
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumProductionWindowDays
  ) {
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
  } else if (
    !evaluateCommunityOperationalCostBaseline(input.operationalBaseline).ready
  ) {
    status = 'operational_baseline_not_ready';
  } else {
    status = 'observed';
  }

  const reviewEligible = status === 'observed';

  return Object.freeze({
    ...normalized,
    realizedRevenueCents,
    actualAttributedCostCents,
    paidConversionRate:
      ratio(normalized.paidConversions, normalized.offersPresented),
    renewalToPaidConversionRate:
      ratio(normalized.renewalSettlements, normalized.paidConversions),
    cancellationToPaidConversionRate:
      ratio(normalized.cancellations, normalized.paidConversions),
    realizedRevenuePerPaidConversionCents:
      perUnit(realizedRevenueCents, normalized.paidConversions),
    attributedCostPerPaidConversionCents:
      perUnit(actualAttributedCostCents, normalized.paidConversions),
    status,
    reviewEligible,
    canChangePrice:
      reviewEligible && isProductCalibrationChangeAllowed(),
  });
}
