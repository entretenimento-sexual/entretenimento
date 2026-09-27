import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateProductCalibrationReviewReadiness,
} from './product-calibration-readiness.policy';

function completeEvidence() {
  return {
    productionWindowDays: 30,
    hotScore: {
      source: 'production_scheduled_runtime',
      observedCycles: 12,
      consecutivePassingCycles: 4,
      promotionReady: true,
    },
    commercialLimits: {
      utilizationSource: 'production_state_aggregate',
      observedDays: 30,
      memberCapacitySamples: 500,
      ownedCommunitySamples: 500,
      actualCostSource: 'cloud_billing_export',
      operationalBaselineReady: true,
    },
    derivedFanout: {
      source: 'cloud_logging_runtime_events',
      observedDays: 14,
      sampleCount: 500,
    },
    notificationFrequency: {
      source: 'cloud_logging_runtime_events',
      observedDays: 14,
      sampleCount: 500,
      pushFanoutBaselineReady: true,
    },
    pricing: {
      financialActualsSource: 'payment_settlement_actuals',
      observedDays: 30,
      offersPresented: 1_000,
      paidConversions: 120,
      renewalSettlements: 80,
      realizedRevenueCents: 300_000,
      actualAttributedCostCents: 90_000,
      operationalBaselineReady: true,
    },
  } as const;
}

test('evidência real suficiente libera apenas revisão durante OBSERVE_ONLY', () => {
  const result = evaluateProductCalibrationReviewReadiness(
    completeEvidence()
  );

  assert.equal(result.stage, 'OBSERVE_ONLY');
  assert.equal(result.allReviewEligible, true);

  for (const dimension of Object.values(result.dimensions)) {
    assert.equal(dimension.reviewEligible, true);
    assert.equal(dimension.canChange, false);
    assert.deepEqual(dimension.missingEvidence, []);
  }
});

test('falha fechado por dimensão quando origem real ou amostra é insuficiente', () => {
  const result = evaluateProductCalibrationReviewReadiness({
    ...completeEvidence(),
    productionWindowDays: 5,
    hotScore: {
      source: 'emulator',
      observedCycles: 2,
      consecutivePassingCycles: 0,
      promotionReady: false,
    },
    commercialLimits: {
      ...completeEvidence().commercialLimits,
      utilizationSource: 'manual_guess',
      memberCapacitySamples: 10,
      actualCostSource: 'payment_settlement_actuals',
    },
    derivedFanout: {
      source: 'fixture',
      observedDays: 2,
      sampleCount: 20,
    },
    notificationFrequency: {
      source: 'fixture',
      observedDays: 2,
      sampleCount: 20,
      pushFanoutBaselineReady: false,
    },
    pricing: {
      ...completeEvidence().pricing,
      financialActualsSource: 'cloud_billing_export',
      paidConversions: 0,
      renewalSettlements: 0,
      realizedRevenueCents: 0,
      actualAttributedCostCents: 0,
    },
  });

  assert.equal(result.allReviewEligible, false);

  assert.deepEqual(
    result.dimensions.hot_score.missingEvidence,
    [
      'production_window',
      'production_ranking_source',
      'ranking_observed_cycles',
      'ranking_consecutive_passing_cycles',
      'ranking_promotion_ready',
    ]
  );
  assert.ok(
    result.dimensions.commercial_limits.missingEvidence.includes(
      'commercial_utilization_source'
    )
  );
  assert.ok(
    result.dimensions.commercial_limits.missingEvidence.includes(
      'commercial_actual_cost_source'
    )
  );
  assert.ok(
    result.dimensions.derived_fanout.missingEvidence.includes(
      'derived_fanout_source'
    )
  );
  assert.ok(
    result.dimensions.notification_frequency.missingEvidence.includes(
      'notification_push_fanout_baseline'
    )
  );
  assert.ok(
    result.dimensions.pricing.missingEvidence.includes(
      'pricing_financial_actuals_source'
    )
  );

  for (const dimension of Object.values(result.dimensions)) {
    assert.equal(dimension.canChange, false);
  }
});

test('não usa dado financeiro de pricing como custo real de limite comercial', () => {
  const result = evaluateProductCalibrationReviewReadiness({
    ...completeEvidence(),
    commercialLimits: {
      ...completeEvidence().commercialLimits,
      actualCostSource: 'payment_settlement_actuals',
    },
  });

  assert.equal(
    result.dimensions.commercial_limits.reviewEligible,
    false
  );
  assert.deepEqual(
    result.dimensions.commercial_limits.missingEvidence,
    ['commercial_actual_cost_source']
  );
  assert.equal(result.dimensions.pricing.reviewEligible, true);
});
