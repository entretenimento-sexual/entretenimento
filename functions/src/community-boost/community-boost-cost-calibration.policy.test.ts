import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_OPERATIONAL_COST_BASELINE_VERSION,
  COMMUNITY_OPERATIONAL_COST_REAL_BASELINE_METRICS,
} from '../shared/observability/operational-cost-baseline.policy';
import {
  evaluateCommunityBoostCostCalibration,
} from './community-boost-cost-calibration.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const START = Date.UTC(2026, 8, 1);

function operationalBaseline() {
  return {
    schemaVersion: COMMUNITY_OPERATIONAL_COST_BASELINE_VERSION,
    source: 'cloud_monitoring_log_metrics',
    environment: 'production',
    projectId: 'entretenimento-sexual',
    windowStartedAt: START,
    windowEndedAt: START + 14 * DAY_MS,
    generatedAt: START + 14 * DAY_MS + 1,
    metrics: Object.fromEntries(
      COMMUNITY_OPERATIONAL_COST_REAL_BASELINE_METRICS.map((metric) => [
        metric,
        {
          sampleCount:
            metric === 'community.storage.upper_bound_bytes_per_community'
              ? 1
              : 150,
          observedDays:
            metric === 'community.storage.upper_bound_bytes_per_community'
              ? 1
              : 7,
        },
      ])
    ),
  };
}

test('calcula custo real por mil placements sem sugerir preço', () => {
  const result = evaluateCommunityBoostCostCalibration({
    servedPlacements: 2_000,
    actualAttributedCostCents: 5_000,
    actualCostSource: 'cloud_billing_export',
    operationalBaseline: operationalBaseline(),
  });

  assert.equal(result.status, 'observed');
  assert.equal(result.actualCostPerThousandServedCents, 2_500);
  assert.equal(result.canCalibrateBoostCost, true);
});

test('não calibra Boost com proxy, sem entrega ou baseline incompleto', () => {
  assert.equal(evaluateCommunityBoostCostCalibration({
    servedPlacements: 0,
    actualAttributedCostCents: 0,
    actualCostSource: 'cloud_billing_export',
    operationalBaseline: operationalBaseline(),
  }).status, 'no_delivery_observation');

  assert.equal(evaluateCommunityBoostCostCalibration({
    servedPlacements: 1_000,
    actualAttributedCostCents: 2_000,
    actualCostSource: 'operational_proxy',
    operationalBaseline: operationalBaseline(),
  }).status, 'actual_cost_source_invalid');

  assert.equal(evaluateCommunityBoostCostCalibration({
    servedPlacements: 1_000,
    actualAttributedCostCents: 2_000,
    actualCostSource: 'cloud_billing_export',
    operationalBaseline: {
      ...operationalBaseline(),
      environment: 'staging',
    },
  }).status, 'operational_baseline_not_ready');
});
