import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityBusinessOfficialCalibration,
} from './community-business-official-calibration.policy';

test('libera calibração somente com oferta, conversão, criação e custo reais', () => {
  assert.deepEqual(
    evaluateCommunityBusinessOfficialCalibration({
      offersPresented: 200,
      conversions: 40,
      communitiesCreated: 52,
      actualCostCents: 26_000,
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
