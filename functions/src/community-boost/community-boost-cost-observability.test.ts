import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(file: string): string {
  return readFileSync(
    path.resolve(process.cwd(), 'src', 'community-boost', file),
    'utf8'
  );
}

test('Boost publica baseline operacional sem entrar no ranking orgânico', () => {
  const handler = source('get-community-boost-placement.handler.ts');
  const selection = source('community-boost-selection.service.ts');

  for (const required of [
    'community_boost_placement_cost_observed',
    'readsProxyPerServedPlacement',
    'writesProxyPerServedPlacement',
    'campaignQueryReadsProxy',
    'sharedControlReads',
    'sharedControlWrites',
  ]) {
    assert.equal(
      handler.includes(required),
      true,
      'telemetria de custo do Boost ausente: ' + required
    );
  }

  assert.equal(
    selection.includes('selectCommunityBoostSponsoredPlacementWithDiagnostics'),
    true
  );
  assert.equal(
    selection.includes('selectCommunityBoostSponsoredPlacement(input'),
    true
  );

  for (const forbidden of [
    'community-ranking',
    'discoveryScore:',
    'rankScore:',
  ]) {
    assert.equal(
      handler.includes(forbidden),
      false,
      'observabilidade patrocinada acoplada ao ranking: ' + forbidden
    );
  }
});

test('policy de custo do Boost analisa custo sem escrever preço comercial', () => {
  const calibration = source('community-boost-cost-calibration.policy.ts');

  for (const required of [
    'cloud_billing_export',
    'finance_actual_allocation',
    'operational_baseline_not_ready',
    'actualCostPerThousandServedCents',
  ]) {
    assert.equal(calibration.includes(required), true);
  }

  for (const forbidden of [
    'rateCpmCents',
    'minBudgetCents',
    'maxBudgetCents',
    'community_boost_billing_config',
  ]) {
    assert.equal(
      calibration.includes(forbidden),
      false,
      'policy analítica não pode recalibrar automaticamente: ' + forbidden
    );
  }
});
