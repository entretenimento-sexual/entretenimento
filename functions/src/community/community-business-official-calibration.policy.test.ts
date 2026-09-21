import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_OPERATIONAL_COST_BASELINE_VERSION,
  COMMUNITY_OPERATIONAL_COST_REAL_BASELINE_METRICS,
} from '../shared/observability/operational-cost-baseline.policy';
import {
  evaluateCommunityBusinessOfficialCalibration,
} from './community-business-official-calibration.policy';

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

test('libera calibração somente com oferta, conversão, criação e custo reais', () => {
  assert.deepEqual(
    evaluateCommunityBusinessOfficialCalibration({
      offersPresented: 200,
      conversions: 40,
      communitiesCreated: 52,
      actualCostCents: 26_000,
      actualCostSource: 'cloud_billing_export',
      operationalBaseline: operationalBaseline(),
    }),
    {
      offersPresented: 200,
      conversions: 40,
      communitiesCreated: 52,
      actualCostCents: 26_000,
      conversionRate: 0.2,
      communitiesPerConversion: 1.3,
      actualCostPerCreatedCommunityCents: 500,
      status: 'observed',
      canCalibrateCommercialOffer: true,
    }
  );
});

test('não calibra produto antes de existir oferta e conversão observadas', () => {
  assert.equal(
    evaluateCommunityBusinessOfficialCalibration({
      offersPresented: 0,
      conversions: 0,
      communitiesCreated: 0,
      actualCostCents: 0,
    }).status,
    'no_supply_observation'
  );

  assert.equal(
    evaluateCommunityBusinessOfficialCalibration({
      offersPresented: 100,
      conversions: 0,
      communitiesCreated: 0,
      actualCostCents: 0,
    }).status,
    'no_conversion_observation'
  );
});

test('exige quantidade criada e custo financeiro realizado', () => {
  assert.equal(
    evaluateCommunityBusinessOfficialCalibration({
      offersPresented: 100,
      conversions: 10,
      communitiesCreated: 0,
      actualCostCents: 0,
    }).status,
    'no_creation_observation'
  );

  assert.equal(
    evaluateCommunityBusinessOfficialCalibration({
      offersPresented: 100,
      conversions: 10,
      communitiesCreated: 12,
      actualCostCents: null,
    }).status,
    'actual_cost_missing'
  );
});

test('falha fechado para observações inválidas ou funil inconsistente', () => {
  for (const input of [
    {
      offersPresented: -1,
      conversions: 0,
      communitiesCreated: 0,
      actualCostCents: 0,
    },
    {
      offersPresented: 10,
      conversions: 11,
      communitiesCreated: 1,
      actualCostCents: 100,
    },
    {
      offersPresented: 10.5,
      conversions: 1,
      communitiesCreated: 1,
      actualCostCents: 100,
    },
  ]) {
    const result = evaluateCommunityBusinessOfficialCalibration(input);
    assert.equal(result.status, 'invalid_observation');
    assert.equal(result.canCalibrateCommercialOffer, false);
  }
});


test('não calibra sem fonte financeira real e baseline operacional pronto', () => {
  assert.equal(
    evaluateCommunityBusinessOfficialCalibration({
      offersPresented: 100,
      conversions: 10,
      communitiesCreated: 12,
      actualCostCents: 5_000,
      actualCostSource: 'operational_proxy',
      operationalBaseline: operationalBaseline(),
    }).status,
    'actual_cost_source_invalid'
  );

  assert.equal(
    evaluateCommunityBusinessOfficialCalibration({
      offersPresented: 100,
      conversions: 10,
      communitiesCreated: 12,
      actualCostCents: 5_000,
      actualCostSource: 'cloud_billing_export',
      operationalBaseline: {
        ...operationalBaseline(),
        environment: 'staging',
      },
    }).status,
    'operational_baseline_not_ready'
  );
});
