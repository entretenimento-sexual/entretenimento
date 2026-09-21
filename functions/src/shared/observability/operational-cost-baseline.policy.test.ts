import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_OPERATIONAL_COST_BASELINE_MIN_DAYS,
  COMMUNITY_OPERATIONAL_COST_BASELINE_VERSION,
  COMMUNITY_OPERATIONAL_COST_REAL_BASELINE_METRICS,
  evaluateCommunityOperationalCostBaseline,
} from './operational-cost-baseline.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const START = Date.UTC(2026, 8, 1);

function readyMetrics(): Record<string, {
  sampleCount: number;
  observedDays: number;
  baselineValue: number;
}> {
  return Object.fromEntries(
    COMMUNITY_OPERATIONAL_COST_REAL_BASELINE_METRICS.map((metric) => [
      metric,
      {
        sampleCount:
          metric === 'community.storage.upper_bound_bytes_per_community'
            ? 2
            : 150,
        observedDays:
          metric === 'community.storage.upper_bound_bytes_per_community'
            ? 2
            : 10,
        baselineValue: 1,
      },
    ])
  );
}

function baseline(overrides: Record<string, unknown> = {}) {
  const windowEndedAt =
    START + COMMUNITY_OPERATIONAL_COST_BASELINE_MIN_DAYS * DAY_MS;

  return {
    schemaVersion: COMMUNITY_OPERATIONAL_COST_BASELINE_VERSION,
    source: 'cloud_monitoring_log_metrics',
    environment: 'production',
    projectId: 'entretenimento-sexual',
    windowStartedAt: START,
    windowEndedAt,
    generatedAt: windowEndedAt + 1,
    metrics: readyMetrics(),
    ...overrides,
  };
}

test('baseline real exige janela mínima e todas as métricas observadas', () => {
  const result = evaluateCommunityOperationalCostBaseline(baseline());

  assert.equal(result.status, 'ready');
  assert.equal(result.ready, true);
  assert.equal(result.windowDays, COMMUNITY_OPERATIONAL_COST_BASELINE_MIN_DAYS);
});

test('staging/sintético nunca libera recalibração comercial', () => {
  const result = evaluateCommunityOperationalCostBaseline(baseline({
    environment: 'staging',
  }));

  assert.equal(result.status, 'non_production_source');
  assert.equal(result.ready, false);
});

test('janela curta ou métrica sem amostragem suficiente falha fechado', () => {
  const short = evaluateCommunityOperationalCostBaseline(baseline({
    windowEndedAt: START + 7 * DAY_MS,
    generatedAt: START + 7 * DAY_MS + 1,
  }));
  assert.equal(short.status, 'window_too_short');

  const metrics = readyMetrics();
  metrics['community.boost.reads_proxy_per_served_placement'] = {
    sampleCount: 99,
    observedDays: 7,
    baselineValue: 12,
  };
  const shallow = evaluateCommunityOperationalCostBaseline(baseline({
    metrics,
  }));
  assert.equal(shallow.status, 'insufficient_samples');
  assert.deepEqual(shallow.insufficientMetrics, [
    'community.boost.reads_proxy_per_served_placement',
  ]);
});
