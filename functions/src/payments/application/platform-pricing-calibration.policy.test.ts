import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluatePlatformPricingCalibration,
} from './platform-pricing-calibration.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

function baseline() {
  const metric = (sampleCount: number, observedDays: number) => ({
    sampleCount,
    observedDays,
    baselineValue: 1,
  });

  return {
    schemaVersion: 1,
    source: 'cloud_logging_runtime_events',
    environment: 'production',
    projectId: 'entretenimento-sexual',
    windowStartedAt: NOW - 14 * DAY_MS,
    windowEndedAt: NOW,
    generatedAt: NOW + 1,
    metrics: {
      'community.discovery.reads_per_card': metric(100, 7),
      'community.discovery.exposure_writes_per_accepted': metric(100, 7),
      'community.notification.push_targets_per_notification': metric(100, 7),
      'community.storage.upper_bound_bytes_per_community': metric(1, 1),
      'community.boost.reads_proxy_per_served_placement': metric(100, 7),
      'community.boost.writes_proxy_per_served_placement': metric(100, 7),
      'community.projection.derived_writes_per_source_event': metric(100, 7),
      'community.notification.grouped_activities_per_push': metric(100, 7),
    },
  };
}

test('pricing fica observável com actuals reais mas bloqueado em OBSERVE_ONLY', () => {
  const result = evaluatePlatformPricingCalibration({
    observedDays: 30,
    offersPresented: 1_000,
    paidConversions: 120,
    renewalSettlements: 80,
    cancellations: 10,
    realizedRevenueCents: 300_000,
    actualAttributedCostCents: 90_000,
    financialActualsSource: 'payment_settlement_actuals',
    operationalBaseline: baseline(),
  });

  assert.equal(result.status, 'observed');
  assert.equal(result.reviewEligible, true);
  assert.equal(result.canChangePrice, false);
  assert.equal(result.paidConversionRate, 0.12);
  assert.equal(result.realizedRevenuePerPaidConversionCents, 2_500);
});

test('pricing rejeita proxy ou ausência de renovação real', () => {
  const noRenewal = evaluatePlatformPricingCalibration({
    observedDays: 30,
    offersPresented: 100,
    paidConversions: 10,
    renewalSettlements: 0,
    cancellations: 0,
    realizedRevenueCents: 10_000,
    actualAttributedCostCents: 2_000,
    financialActualsSource: 'payment_settlement_actuals',
    operationalBaseline: baseline(),
  });
  assert.equal(noRenewal.status, 'no_renewal_observation');

  const invalidSource = evaluatePlatformPricingCalibration({
    observedDays: 30,
    offersPresented: 100,
    paidConversions: 10,
    renewalSettlements: 5,
    cancellations: 0,
    realizedRevenueCents: 10_000,
    actualAttributedCostCents: 2_000,
    financialActualsSource: 'operational_proxy',
    operationalBaseline: baseline(),
  });
  assert.equal(invalidSource.status, 'financial_source_invalid');
});
