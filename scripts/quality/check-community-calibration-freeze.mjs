// scripts/quality/check-community-calibration-freeze.mjs
// Mantém score/capacidade/monetização em OBSERVE_ONLY até revisão explícita
// baseada em ciclos reais + baseline operacional + custo financeiro realizado.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[community-calibration-freeze] drift: ' + label);
  }
}

const stage = read('functions/src/community/community-calibration-stage.policy.ts');
requireIncludes(
  stage,
  "export const COMMUNITY_CALIBRATION_STAGE = 'OBSERVE_ONLY' as const;",
  'calibration stage must remain OBSERVE_ONLY'
);
for (const fragment of [
  'rankingV3ObservedCycles: 7',
  'rankingV3ConsecutivePassingCycles: 3',
  'operationalCostBaselineMinimumDays: 14',
  'requiresProductionScheduledRankingEvidence: true',
  'requiresProductionOperationalCostBaseline: true',
  'requiresFinancialActualsForCommercialCalibration: true',
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
  "mode: 'observed_data_only'",
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

const baseline = read(
  'functions/src/shared/observability/operational-cost-baseline.policy.ts'
);
for (const fragment of [
  'export const COMMUNITY_OPERATIONAL_COST_BASELINE_MIN_DAYS = 14;',
  'minimumSamples: 100,',
  'minimumObservedDays: 7,',
]) {
  requireIncludes(baseline, fragment, 'operational baseline changed: ' + fragment);
}

const contract = JSON.parse(
  read('ops/monitoring/community-cost/contract.json')
);
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
  '[community-calibration-freeze] OK: OBSERVE_ONLY preserves v3 tuning, Official capacity, commercial gates and cost thresholds.'
);
