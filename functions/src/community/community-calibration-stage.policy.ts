// functions/src/community/community-calibration-stage.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY CALIBRATION STAGE
// -----------------------------------------------------------------------------
// Gate transversal para impedir calibração por intuição.
//
// OBSERVE_ONLY:
// - v3 continua shadow-only;
// - Business/Official e Boost podem calcular snapshots observacionais;
// - snapshots NÃO autorizam alteração de preço, capacidade ou monetização;
// - thresholds operacionais permanecem congelados.
//
// A saída deste estágio exige decisão explícita após:
// 1. janela v3 de produção cumprir os ciclos mínimos;
// 2. baseline operacional real de produção estar qualificado;
// 3. custos financeiros realizados estarem disponíveis quando aplicável.
// -----------------------------------------------------------------------------

export const COMMUNITY_CALIBRATION_STAGE = 'OBSERVE_ONLY' as const;

export type CommunityCalibrationStage =
  | 'OBSERVE_ONLY'
  | 'CALIBRATION_ALLOWED';

export const COMMUNITY_CALIBRATION_REQUIRED_EVIDENCE = Object.freeze({
  rankingV3ObservedCycles: 7,
  rankingV3ConsecutivePassingCycles: 3,
  operationalCostBaselineMinimumDays: 14,
  requiresProductionScheduledRankingEvidence: true,
  requiresProductionOperationalCostBaseline: true,
  requiresFinancialActualsForCommercialCalibration: true,
} as const);

export function isCommunityCalibrationChangeAllowed(): boolean {
  return COMMUNITY_CALIBRATION_STAGE ===
    ('CALIBRATION_ALLOWED' as CommunityCalibrationStage);
}
