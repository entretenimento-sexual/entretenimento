import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_CALIBRATION_REQUIRED_EVIDENCE,
  PRODUCT_CALIBRATION_STAGE,
  isProductCalibrationChangeAllowed,
} from './product-calibration-stage.policy';

test('produto permanece OBSERVE_ONLY até decisão explícita', () => {
  assert.equal(PRODUCT_CALIBRATION_STAGE, 'OBSERVE_ONLY');
  assert.equal(isProductCalibrationChangeAllowed(), false);
});

test('evidência transversal cobre os cinco eixos de calibração', () => {
  assert.deepEqual(PRODUCT_CALIBRATION_REQUIRED_EVIDENCE, {
    minimumProductionWindowDays: 14,
    minimumObservedDaysPerRuntimeMetric: 7,
    minimumRuntimeSamplesPerMetric: 100,
    rankingObservedCycles: 7,
    rankingConsecutivePassingCycles: 3,
    requiresProductionRuntimeEvidence: true,
    requiresFinancialActualsForPricing: true,
    requiresObservedCommercialUtilization: true,
    requiresObservedDerivedFanout: true,
    requiresObservedNotificationGrouping: true,
  });
});
