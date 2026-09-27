// functions/src/shared/calibration/product-calibration-readiness.policy.ts
// -----------------------------------------------------------------------------
// PRODUCT CALIBRATION REVIEW READINESS
// -----------------------------------------------------------------------------
// Consolida, por dimensão, se já existe evidência REAL suficiente para revisão
// humana. Esta policy NÃO recomenda valores e NÃO altera score, limites, fan-out,
// cadência ou preço.
//
// Mesmo quando uma dimensão fica reviewEligible, canChange permanece false
// enquanto PRODUCT_CALIBRATION_STAGE estiver em OBSERVE_ONLY.
// -----------------------------------------------------------------------------

import {
  PRODUCT_CALIBRATION_REQUIRED_EVIDENCE,
  PRODUCT_CALIBRATION_STAGE,
  isProductCalibrationChangeAllowed,
} from './product-calibration-stage.policy';

export type ProductCalibrationDimension =
  | 'hot_score'
  | 'commercial_limits'
  | 'derived_fanout'
  | 'notification_frequency'
  | 'pricing';

export interface ProductCalibrationDimensionReadiness {
  readonly reviewEligible: boolean;
  readonly canChange: boolean;
  readonly missingEvidence: readonly string[];
}

export interface ProductCalibrationReviewReadiness {
  readonly stage: typeof PRODUCT_CALIBRATION_STAGE;
  readonly productionWindowDays: number;
  readonly allReviewEligible: boolean;
  readonly dimensions: Readonly<
    Record<ProductCalibrationDimension, ProductCalibrationDimensionReadiness>
  >;
}

export interface ProductCalibrationReviewReadinessInput {
  readonly productionWindowDays: unknown;

  readonly hotScore: Readonly<{
    source: unknown;
    observedCycles: unknown;
    consecutivePassingCycles: unknown;
    promotionReady: unknown;
  }>;

  readonly commercialLimits: Readonly<{
    utilizationSource: unknown;
    observedDays: unknown;
    memberCapacitySamples: unknown;
    ownedCommunitySamples: unknown;
    actualCostSource: unknown;
    operationalBaselineReady: unknown;
  }>;

  readonly derivedFanout: Readonly<{
    source: unknown;
    observedDays: unknown;
    sampleCount: unknown;
  }>;

  readonly notificationFrequency: Readonly<{
    source: unknown;
    observedDays: unknown;
    sampleCount: unknown;
    pushFanoutBaselineReady: unknown;
  }>;

  readonly pricing: Readonly<{
    financialActualsSource: unknown;
    observedDays: unknown;
    offersPresented: unknown;
    paidConversions: unknown;
    renewalSettlements: unknown;
    realizedRevenueCents: unknown;
    actualAttributedCostCents: unknown;
    operationalBaselineReady: unknown;
  }>;
}

function nonNegativeInteger(value: unknown): number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    ? value
    : 0;
}

function isCommercialActualCostSource(value: unknown): boolean {
  return value === 'cloud_billing_export'
    || value === 'finance_actual_allocation';
}

function isPricingFinancialActualSource(value: unknown): boolean {
  return value === 'payment_settlement_actuals'
    || value === 'finance_actual_allocation';
}

function readiness(
  missingEvidence: readonly string[]
): Readonly<ProductCalibrationDimensionReadiness> {
  const missing = Object.freeze([...new Set(missingEvidence)]);
  const reviewEligible = missing.length === 0;

  return Object.freeze({
    reviewEligible,
    canChange:
      reviewEligible && isProductCalibrationChangeAllowed(),
    missingEvidence: missing,
  });
}

function requireProductionWindow(
  productionWindowDays: number,
  missing: string[]
): void {
  if (
    productionWindowDays
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumProductionWindowDays
  ) {
    missing.push('production_window');
  }
}

export function evaluateProductCalibrationReviewReadiness(
  input: ProductCalibrationReviewReadinessInput
): Readonly<ProductCalibrationReviewReadiness> {
  const productionWindowDays =
    nonNegativeInteger(input.productionWindowDays);

  const hotMissing: string[] = [];
  requireProductionWindow(productionWindowDays, hotMissing);
  if (input.hotScore.source !== 'production_scheduled_runtime') {
    hotMissing.push('production_ranking_source');
  }
  if (
    nonNegativeInteger(input.hotScore.observedCycles)
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.rankingObservedCycles
  ) {
    hotMissing.push('ranking_observed_cycles');
  }
  if (
    nonNegativeInteger(input.hotScore.consecutivePassingCycles)
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE
        .rankingConsecutivePassingCycles
  ) {
    hotMissing.push('ranking_consecutive_passing_cycles');
  }
  if (input.hotScore.promotionReady !== true) {
    hotMissing.push('ranking_promotion_ready');
  }

  const commercialMissing: string[] = [];
  requireProductionWindow(productionWindowDays, commercialMissing);
  if (
    input.commercialLimits.utilizationSource
      !== 'production_state_aggregate'
  ) {
    commercialMissing.push('commercial_utilization_source');
  }
  if (
    nonNegativeInteger(input.commercialLimits.observedDays)
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumProductionWindowDays
  ) {
    commercialMissing.push('commercial_utilization_window');
  }
  if (
    nonNegativeInteger(input.commercialLimits.memberCapacitySamples)
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumRuntimeSamplesPerMetric
  ) {
    commercialMissing.push('member_capacity_samples');
  }
  if (
    nonNegativeInteger(input.commercialLimits.ownedCommunitySamples)
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumRuntimeSamplesPerMetric
  ) {
    commercialMissing.push('owned_community_samples');
  }
  if (!isCommercialActualCostSource(input.commercialLimits.actualCostSource)) {
    commercialMissing.push('commercial_actual_cost_source');
  }
  if (input.commercialLimits.operationalBaselineReady !== true) {
    commercialMissing.push('commercial_operational_baseline');
  }

  const derivedMissing: string[] = [];
  requireProductionWindow(productionWindowDays, derivedMissing);
  if (input.derivedFanout.source !== 'cloud_logging_runtime_events') {
    derivedMissing.push('derived_fanout_source');
  }
  if (
    nonNegativeInteger(input.derivedFanout.observedDays)
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE
        .minimumObservedDaysPerRuntimeMetric
  ) {
    derivedMissing.push('derived_fanout_observed_days');
  }
  if (
    nonNegativeInteger(input.derivedFanout.sampleCount)
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumRuntimeSamplesPerMetric
  ) {
    derivedMissing.push('derived_fanout_samples');
  }

  const notificationMissing: string[] = [];
  requireProductionWindow(productionWindowDays, notificationMissing);
  if (
    input.notificationFrequency.source
      !== 'cloud_logging_runtime_events'
  ) {
    notificationMissing.push('notification_grouping_source');
  }
  if (
    nonNegativeInteger(input.notificationFrequency.observedDays)
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE
        .minimumObservedDaysPerRuntimeMetric
  ) {
    notificationMissing.push('notification_grouping_observed_days');
  }
  if (
    nonNegativeInteger(input.notificationFrequency.sampleCount)
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumRuntimeSamplesPerMetric
  ) {
    notificationMissing.push('notification_grouping_samples');
  }
  if (input.notificationFrequency.pushFanoutBaselineReady !== true) {
    notificationMissing.push('notification_push_fanout_baseline');
  }

  const pricingMissing: string[] = [];
  requireProductionWindow(productionWindowDays, pricingMissing);
  const pricingObservedDays =
    nonNegativeInteger(input.pricing.observedDays);
  const offersPresented =
    nonNegativeInteger(input.pricing.offersPresented);
  const paidConversions =
    nonNegativeInteger(input.pricing.paidConversions);
  const renewalSettlements =
    nonNegativeInteger(input.pricing.renewalSettlements);
  const realizedRevenueCents =
    nonNegativeInteger(input.pricing.realizedRevenueCents);
  const actualAttributedCostCents =
    nonNegativeInteger(input.pricing.actualAttributedCostCents);

  if (
    pricingObservedDays
      < PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumProductionWindowDays
  ) {
    pricingMissing.push('pricing_observed_window');
  }
  if (offersPresented <= 0) {
    pricingMissing.push('pricing_offer_observation');
  }
  if (paidConversions <= 0 || paidConversions > offersPresented) {
    pricingMissing.push('pricing_paid_conversions');
  }
  if (renewalSettlements <= 0) {
    pricingMissing.push('pricing_renewal_settlements');
  }
  if (!isPricingFinancialActualSource(input.pricing.financialActualsSource)) {
    pricingMissing.push('pricing_financial_actuals_source');
  }
  if (realizedRevenueCents <= 0) {
    pricingMissing.push('pricing_realized_revenue');
  }
  if (actualAttributedCostCents <= 0) {
    pricingMissing.push('pricing_attributed_actual_cost');
  }
  if (input.pricing.operationalBaselineReady !== true) {
    pricingMissing.push('pricing_operational_baseline');
  }

  const dimensions = Object.freeze({
    hot_score: readiness(hotMissing),
    commercial_limits: readiness(commercialMissing),
    derived_fanout: readiness(derivedMissing),
    notification_frequency: readiness(notificationMissing),
    pricing: readiness(pricingMissing),
  });

  return Object.freeze({
    stage: PRODUCT_CALIBRATION_STAGE,
    productionWindowDays,
    allReviewEligible:
      Object.values(dimensions).every(
        (dimension) => dimension.reviewEligible
      ),
    dimensions,
  });
}
