// scripts/quality/check-community-calibration-freeze.mjs
// Mantém score/capacidade/monetização em OBSERVE_ONLY até revisão explícita
// baseada em ciclos reais + baseline operacional + custo financeiro realizado.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evaluatePlatformPricingCalibration,
} from './platform-pricing-calibration.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[community-calibration-freeze] drift: ' + label);
  }
}

const productStage = read(
  'functions/src/shared/calibration/product-calibration-stage.policy.ts'
);
requireIncludes(
  productStage,
  "export const PRODUCT_CALIBRATION_STAGE = 'OBSERVE_ONLY' as const;",
  'canonical product calibration stage must remain OBSERVE_ONLY'
);
for (const fragment of [
  'minimumProductionWindowDays: 14',
  'minimumObservedDaysPerRuntimeMetric: 7',
  'minimumRuntimeSamplesPerMetric: 100',
  'rankingObservedCycles: 7',
  'rankingConsecutivePassingCycles: 3',
  'requiresFinancialActualsForPricing: true',
  'requiresObservedCommercialUtilization: true',
  'requiresObservedDerivedFanout: true',
  'requiresObservedNotificationGrouping: true',
]) {
  requireIncludes(
    productStage,
    fragment,
    'canonical product evidence changed: ' + fragment
  );
}

const readiness = read(
  'functions/src/shared/calibration/product-calibration-readiness.policy.ts'
);
for (const fragment of [
  "'production_scheduled_runtime'",
  "'production_state_aggregate'",
  "'cloud_logging_runtime_events'",
  "'cloud_billing_export'",
  "'payment_settlement_actuals'",
  "'finance_actual_allocation'",
  "'hot_score'",
  "'commercial_limits'",
  "'derived_fanout'",
  "'notification_frequency'",
  "'pricing'",
  'minimumProductionWindowDays',
  'minimumObservedDaysPerRuntimeMetric',
  'minimumRuntimeSamplesPerMetric',
  'rankingObservedCycles',
  'rankingConsecutivePassingCycles',
  'reviewEligible && isProductCalibrationChangeAllowed()',
]) {
  requireIncludes(
    readiness,
    fragment,
    'product calibration readiness drift: ' + fragment
  );
}

const stage = read('functions/src/community/community-calibration-stage.policy.ts');
for (const fragment of [
  'rankingV3ObservedCycles:',
  'rankingV3ConsecutivePassingCycles:',
  'operationalCostBaselineMinimumDays:',
  'minimumRuntimeSamplesPerMetric:',
  'minimumObservedDaysPerRuntimeMetric:',
  'requiresProductionScheduledRankingEvidence: true',
  'requiresProductionOperationalCostBaseline:',
  'requiresFinancialActualsForCommercialCalibration:',
  'requiresObservedCommercialUtilization:',
  'requiresObservedDerivedFanout:',
  'requiresObservedNotificationGrouping:',
]) {
  requireIncludes(stage, fragment, 'required evidence changed: ' + fragment);
}

const v3 = read('functions/src/community/community-ranking-candidate-v3.policy.ts');
for (const fragment of [
  'export const COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION = 3;',
  'export const COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION = 2;',
  'export const COMMUNITY_ACTIVITY_CONFIDENCE_MODEL_VERSION = 1;',
  'const SHORT_HALF_LIFE_DAYS = 7;',
  'const MEDIUM_HALF_LIFE_DAYS = 30;',
  'const MAX_MOMENTUM = 10_000;',
  'const ACTIVITY_CONFIDENCE_PRIOR_UNITS = 18;',
  'const MEDIUM_TERM_EVIDENCE_WEIGHT = 0.20;',
  'quality: 0.15,',
  'activity: 0.55,',
  'freshness: 0.30,',
]) {
  requireIncludes(v3, fragment, 'ranking v3 tuning changed: ' + fragment);
}

const acceptance = read(
  'functions/src/community/community-ranking-v3-acceptance.policy.ts'
);
for (const fragment of [
  'export const COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES = 7;',
  'export const COMMUNITY_RANKING_V3_MIN_CONSECUTIVE_PASSING_CYCLES = 3;',
  'minimumComparisonDepth: 20,',
  'minimumOverlapRate: 60,',
  'minimumRankAgreement: 75,',
  'maximumMeanAbsoluteRankShift: 6,',
  'maximumAbsoluteRankShift: 18,',
  'minimumCandidateAgeCoverageRate: 90,',
  'maximumAbsoluteNewShareDelta: 20,',
]) {
  requireIncludes(
    acceptance,
    fragment,
    'ranking v3 acceptance threshold changed: ' + fragment
  );
}

const rollout = read('functions/src/community/community-ranking-rollout.policy.ts');
for (const fragment of [
  "denialReason: 'calibration_observation_only'",
  'isCommunityCalibrationChangeAllowed()',
]) {
  requireIncludes(rollout, fragment, 'v3 promotion freeze missing: ' + fragment);
}

const productLimits = read(
  'functions/src/community/community-product-limits.config.ts'
);
for (const fragment of [
  'maxMemberLimit: 1_000,',
  'maxCommunitiesPerGrant: 20,',
  'basic: 100,',
  'premium: 250,',
  'vip: 500,',
  'basic: 1,',
  'premium: 2,',
  'vip: 3,',
  "mode: 'observed_data_only'",
  "'member_capacity_utilization_p95'",
  "'owned_community_utilization_p95'",
  'operationalCostProxyAllowedAsActualCost: false',
]) {
  requireIncludes(
    productLimits,
    fragment,
    'Business/Official capacity/calibration changed: ' + fragment
  );
}

const businessCalibration = read(
  'functions/src/community/community-business-official-calibration.policy.ts'
);
for (const fragment of [
  'evaluateCommunityOperationalCostBaseline',
  'isCommunityCalibrationChangeAllowed',
  "input.actualCostSource !== 'cloud_billing_export'",
  "input.actualCostSource !== 'finance_actual_allocation'",
  "input.commercialUtilizationSource !== 'production_state_aggregate'",
  'memberCapacityUtilizationSamples',
  'ownedCommunityUtilizationSamples',
]) {
  requireIncludes(
    businessCalibration,
    fragment,
    'Business/Official commercial gate changed: ' + fragment
  );
}

const boostCalibration = read(
  'functions/src/community-boost/community-boost-cost-calibration.policy.ts'
);
for (const fragment of [
  'evaluateCommunityOperationalCostBaseline',
  'isCommunityCalibrationChangeAllowed',
  "input.actualCostSource !== 'cloud_billing_export'",
  "input.actualCostSource !== 'finance_actual_allocation'",
]) {
  requireIncludes(
    boostCalibration,
    fragment,
    'Boost calibration gate changed: ' + fragment
  );
}


const businessEntitlement = read(
  'functions/src/business-official/business-official-entitlement.policy.ts'
);
for (const fragment of [
  "'amountCents'",
  "'currency'",
  "'plan'",
  "'planId'",
  "'planKey'",
  "'price'",
  "'priceCents'",
  'hasForbiddenOfferFields',
]) {
  requireIncludes(
    businessEntitlement,
    fragment,
    'Business/Official entitlement must remain price-free: ' + fragment
  );
}

const baseline = read(
  'functions/src/shared/observability/operational-cost-baseline.policy.ts'
);
for (const fragment of [
  'export const COMMUNITY_OPERATIONAL_COST_BASELINE_MIN_DAYS = 14;',
  'minimumSamples: 100,',
  'minimumObservedDays: 7,',
  "'community.projection.derived_writes_per_source_event'",
  "'community.notification.grouped_activities_per_push'",
]) {
  requireIncludes(baseline, fragment, 'operational baseline changed: ' + fragment);
}

const notificationPolicy = read(
  'functions/src/community/community-notification.policy.ts'
);
requireIncludes(
  notificationPolicy,
  'const COMMENT_GROUP_WINDOW_MS = 24 * 60 * 60 * 1_000;',
  'notification grouping window changed without real-data calibration'
);

const pricingCatalog = read(
  'functions/src/payments/application/billing-plan-catalog.service.ts'
);
for (const fragment of [
  'export const PLATFORM_BILLING_CATALOG_VERSION = 1;',
  'amountCents: 1999,',
  'amountCents: 2999,',
  'amountCents: 3999,',
]) {
  requireIncludes(
    pricingCatalog,
    fragment,
    'platform pricing changed during OBSERVE_ONLY: ' + fragment
  );
}

const pricingCalibration = read(
  'scripts/quality/platform-pricing-calibration.mjs'
);
for (const fragment of [
  "'payment_settlement_actuals'",
  "'finance_actual_allocation'",
  "'payment_settlement_actuals'",
  "'finance_actual_allocation'",
  'operationalBaselineReady',
  'reviewEligible',
  'canChangePrice',
]) {
  requireIncludes(
    pricingCalibration,
    fragment,
    'pricing real-data calibration gate missing: ' + fragment
  );
}

const pricingReadiness = evaluatePlatformPricingCalibration({
  calibrationStage: 'OBSERVE_ONLY',
  observedDays: 30,
  offersPresented: 1_000,
  paidConversions: 120,
  renewalSettlements: 80,
  cancellations: 10,
  realizedRevenueCents: 300_000,
  actualAttributedCostCents: 90_000,
  financialActualsSource: 'payment_settlement_actuals',
  operationalBaselineReady: true,
});
if (
  pricingReadiness.status !== 'observed'
  || pricingReadiness.reviewEligible !== true
  || pricingReadiness.canChangePrice !== false
) {
  throw new Error(
    '[community-calibration-freeze] pricing readiness must remain review-only during OBSERVE_ONLY'
  );
}

const runtimeObservation = read(
  'functions/src/shared/observability/product-calibration-observation.policy.ts'
);
for (const fragment of [
  "'community.projection.derived_writes_per_source_event'",
  "'community.notification.grouped_activities_per_push'",
  "'production_runtime_observation'",
]) {
  requireIncludes(
    runtimeObservation,
    fragment,
    'runtime calibration observation missing: ' + fragment
  );
}

for (const [file, fragment] of [
  [
    'functions/src/notifications/sendNotification.ts',
    "'community.notification.grouped_activities_per_push'",
  ],
  [
    'functions/src/community/sync-community-feed-realtime.trigger.ts',
    "'community.projection.derived_writes_per_source_event'",
  ],
  [
    'functions/src/community/sync-community-profile-membership-index.trigger.ts',
    "'community.projection.derived_writes_per_source_event'",
  ],
  [
    'functions/src/community/sync-community-ranking.trigger.ts',
    "'community.projection.derived_writes_per_source_event'",
  ],
  [
    'functions/src/community/sync-community-notification-summary.trigger.ts',
    "'community.projection.derived_writes_per_source_event'",
  ],
]) {
  requireIncludes(
    read(file),
    fragment,
    'runtime calibration wiring missing: ' + file
  );
}

const contract = JSON.parse(
  read('ops/monitoring/community-cost/contract.json')
);
for (const key of [
  'community.projection.derived_writes_per_source_event',
  'community.notification.grouped_activities_per_push',
]) {
  const metric = contract.metrics.find((item) => item.key === key);
  if (!metric) {
    throw new Error('[community-calibration-freeze] missing real-data metric: ' + key);
  }
  if (
    metric.minimumSamples !== 100
    || metric.minimumObservedDays !== 7
    || metric.budgeted !== false
  ) {
    throw new Error(
      '[community-calibration-freeze] real-data metric gate changed: ' + key
    );
  }
}

const expectedBudgeted = {
  'community.discovery.reads_per_card': {
    warningAbove: 3.5,
    criticalAbove: 5,
    minimumSamples: 100,
    minimumObservedDays: 7,
  },
  'community.discovery.exposure_writes_per_accepted': {
    warningAbove: 1.5,
    criticalAbove: 2,
    minimumSamples: 100,
    minimumObservedDays: 7,
  },
  'community.notification.push_targets_per_notification': {
    warningAbove: 5,
    criticalAbove: 8,
    minimumSamples: 100,
    minimumObservedDays: 7,
  },
  'community.storage.upper_bound_bytes_per_community': {
    warningAbove: 536870912,
    criticalAbove: 1073741824,
    minimumSamples: 1,
    minimumObservedDays: 1,
  },
};

for (const [key, expected] of Object.entries(expectedBudgeted)) {
  const metric = contract.metrics.find((item) => item.key === key);
  if (!metric) throw new Error('[community-calibration-freeze] missing metric: ' + key);
  for (const [field, value] of Object.entries(expected)) {
    if (metric[field] !== value) {
      throw new Error(
        '[community-calibration-freeze] cost threshold changed: '
        + key + '.' + field + ' expected=' + value + ' actual=' + metric[field]
      );
    }
  }
}

const budget = read(
  'functions/src/shared/observability/operational-cost-budget.policy.ts'
);
for (const fragment of [
  'targetMax: 2.5,',
  'warningAbove: 3.5,',
  'criticalAbove: 5,',
  'targetMax: 1.25,',
  'warningAbove: 1.5,',
  'criticalAbove: 2,',
  'targetMax: 4,',
  'warningAbove: 6,',
  'criticalAbove: 10,',
  'targetMax: 3,',
  'warningAbove: 5,',
  'criticalAbove: 8,',
  'targetMax: 256 * MIB,',
  'warningAbove: 512 * MIB,',
  'criticalAbove: GIB,',
]) {
  requireIncludes(budget, fragment, 'operational cost budget changed: ' + fragment);
}

console.log(
  '[community-calibration-freeze] OK: OBSERVE_ONLY preserves hot score, commercial limits, derivative fanout, notification cadence, pricing and cost thresholds until real evidence is reviewable.'
);
