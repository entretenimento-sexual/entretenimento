// functions/src/shared/calibration/product-calibration-stage.policy.ts
// -----------------------------------------------------------------------------
// PRODUCT CALIBRATION STAGE
// -----------------------------------------------------------------------------
// Fonte canônica transversal para calibração baseada em evidência real.
//
// OBSERVE_ONLY:
// - coleta e qualifica observações reais;
// - pode declarar uma dimensão elegível para revisão;
// - NUNCA altera automaticamente score, limites, fan-out, cadência ou preço.
//
// CALIBRATION_ALLOWED só pode ser ativado por decisão explícita após revisão dos
// artefatos de produção. Nenhum contador, baseline ou workflow promove o estágio
// sozinho.
// -----------------------------------------------------------------------------

export const PRODUCT_CALIBRATION_STAGE = 'OBSERVE_ONLY' as const;

export type ProductCalibrationStage =
  | 'OBSERVE_ONLY'
  | 'CALIBRATION_ALLOWED';

export const PRODUCT_CALIBRATION_REQUIRED_EVIDENCE = Object.freeze({
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
} as const);

export function isProductCalibrationChangeAllowed(): boolean {
  return String(PRODUCT_CALIBRATION_STAGE) === 'CALIBRATION_ALLOWED';
}
