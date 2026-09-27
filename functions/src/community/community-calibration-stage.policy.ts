// functions/src/community/community-calibration-stage.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY CALIBRATION STAGE
// -----------------------------------------------------------------------------
// Compatibilidade do domínio Community com o estágio canônico transversal.
//
// A fonte de verdade agora vive em shared/calibration para que ranking/hot score,
// limites comerciais, fan-out de derivados, cadência de notificações e pricing
// obedeçam à mesma regra: observar dados reais primeiro; calibrar somente após
// revisão explícita.
// -----------------------------------------------------------------------------

import {
  PRODUCT_CALIBRATION_REQUIRED_EVIDENCE,
  PRODUCT_CALIBRATION_STAGE,
  isProductCalibrationChangeAllowed,
  type ProductCalibrationStage,
} from '../shared/calibration/product-calibration-stage.policy';
export {
  evaluateProductCalibrationReviewReadiness,
  type ProductCalibrationDimension,
  type ProductCalibrationDimensionReadiness,
  type ProductCalibrationReviewReadiness,
  type ProductCalibrationReviewReadinessInput,
} from '../shared/calibration/product-calibration-readiness.policy';

export const COMMUNITY_CALIBRATION_STAGE = PRODUCT_CALIBRATION_STAGE;

export type CommunityCalibrationStage = ProductCalibrationStage;

export const COMMUNITY_CALIBRATION_REQUIRED_EVIDENCE = Object.freeze({
  rankingV3ObservedCycles:
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.rankingObservedCycles,
  rankingV3ConsecutivePassingCycles:
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.rankingConsecutivePassingCycles,
  operationalCostBaselineMinimumDays:
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumProductionWindowDays,
  minimumRuntimeSamplesPerMetric:
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumRuntimeSamplesPerMetric,
  minimumObservedDaysPerRuntimeMetric:
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumObservedDaysPerRuntimeMetric,
  requiresProductionScheduledRankingEvidence: true,
  requiresProductionOperationalCostBaseline:
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.requiresProductionRuntimeEvidence,
  requiresFinancialActualsForCommercialCalibration:
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.requiresFinancialActualsForPricing,
  requiresObservedCommercialUtilization:
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.requiresObservedCommercialUtilization,
  requiresObservedDerivedFanout:
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.requiresObservedDerivedFanout,
  requiresObservedNotificationGrouping:
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.requiresObservedNotificationGrouping,
} as const);

export function isCommunityCalibrationChangeAllowed(): boolean {
  return isProductCalibrationChangeAllowed();
}
