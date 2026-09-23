import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_CALIBRATION_REQUIRED_EVIDENCE,
  COMMUNITY_CALIBRATION_STAGE,
  isCommunityCalibrationChangeAllowed,
} from './community-calibration-stage.policy';

test('mantém Comunidades em observação sem liberar calibração', () => {
  assert.equal(COMMUNITY_CALIBRATION_STAGE, 'OBSERVE_ONLY');
  assert.equal(isCommunityCalibrationChangeAllowed(), false);
});

test('documenta os gates mínimos antes de futura calibração', () => {
  assert.deepEqual(COMMUNITY_CALIBRATION_REQUIRED_EVIDENCE, {
    rankingV3ObservedCycles: 7,
    rankingV3ConsecutivePassingCycles: 3,
    operationalCostBaselineMinimumDays: 14,
    requiresProductionScheduledRankingEvidence: true,
    requiresProductionOperationalCostBaseline: true,
    requiresFinancialActualsForCommercialCalibration: true,
  });
});
