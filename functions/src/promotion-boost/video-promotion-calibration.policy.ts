// functions/src/promotion-boost/video-promotion-calibration.policy.ts
// -----------------------------------------------------------------------------
// VIDEO PROMOTION CALIBRATION
// -----------------------------------------------------------------------------
// Vídeo pertence ao contrato genérico de Promotion/Boost, mas permanece fora do
// runtime comercial. A saída de OBSERVE_ONLY exige evidência REAL de produção
// nas dimensões custo, consumo e abuso e, mesmo assim, não habilita campanha ou
// placement automaticamente: enablement continua sendo decisão explícita,
// versionada e protegida por gate.
// -----------------------------------------------------------------------------

import {
  PRODUCT_CALIBRATION_REQUIRED_EVIDENCE,
  type ProductCalibrationStage,
} from '../shared/calibration/product-calibration-stage.policy';

export const VIDEO_PROMOTION_CALIBRATION_POLICY_VERSION = 1 as const;
export const VIDEO_PROMOTION_CALIBRATION_STAGE:
  ProductCalibrationStage = 'OBSERVE_ONLY';

/**
 * Kill switch canônico do runtime pago de Vídeo.
 *
 * Não deriva do estágio e não pode ser promovido automaticamente por métricas.
 * Uma liberação futura exige mudança explícita de código depois que a evidência
 * de saída de OBSERVE_ONLY estiver qualificada.
 */
export const VIDEO_PROMOTION_RUNTIME_ENABLEMENT = false as const;

export const VIDEO_PROMOTION_OBSERVATION_SOURCE =
  'production_runtime_observation' as const;

export interface VideoPromotionEvidenceDimension {
  readonly observedDays: number;
  readonly runtimeSamples: number;
  readonly sufficient: boolean;
}

export interface VideoPromotionCostEvidence
  extends VideoPromotionEvidenceDimension {
  readonly financialActualsComplete: boolean;
}

export interface VideoPromotionConsumptionEvidence
  extends VideoPromotionEvidenceDimension {
  readonly commercialUtilizationObserved: boolean;
}

export interface VideoPromotionAbuseEvidence
  extends VideoPromotionEvidenceDimension {
  readonly abuseSignalsObserved: boolean;
  readonly reviewComplete: boolean;
}

export interface VideoPromotionExitEvidence {
  readonly policyVersion: typeof VIDEO_PROMOTION_CALIBRATION_POLICY_VERSION;
  readonly observationSource: typeof VIDEO_PROMOTION_OBSERVATION_SOURCE;
  readonly realDataQualified: boolean;
  readonly productionWindowDays: number;
  readonly cost: VideoPromotionCostEvidence;
  readonly consumption: VideoPromotionConsumptionEvidence;
  readonly abuse: VideoPromotionAbuseEvidence;
  readonly reviewedAt: number;
  readonly reviewedBy: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dimensionReady(raw: unknown): boolean {
  const source = asRecord(raw);

  return source['sufficient'] === true
    && normalizeCount(source['observedDays'])
      >= PRODUCT_CALIBRATION_REQUIRED_EVIDENCE
        .minimumObservedDaysPerRuntimeMetric
    && normalizeCount(source['runtimeSamples'])
      >= PRODUCT_CALIBRATION_REQUIRED_EVIDENCE
        .minimumRuntimeSamplesPerMetric;
}

export function isVideoPromotionExitEvidenceReady(
  raw: unknown
): boolean {
  const evidence = asRecord(raw);
  const cost = asRecord(evidence['cost']);
  const consumption = asRecord(evidence['consumption']);
  const abuse = asRecord(evidence['abuse']);

  return Number(evidence['policyVersion'])
      === VIDEO_PROMOTION_CALIBRATION_POLICY_VERSION
    && evidence['observationSource']
      === VIDEO_PROMOTION_OBSERVATION_SOURCE
    && evidence['realDataQualified'] === true
    && normalizeCount(evidence['productionWindowDays'])
      >= PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumProductionWindowDays
    && dimensionReady(cost)
    && cost['financialActualsComplete'] === true
    && dimensionReady(consumption)
    && consumption['commercialUtilizationObserved'] === true
    && dimensionReady(abuse)
    && abuse['abuseSignalsObserved'] === true
    && abuse['reviewComplete'] === true
    && normalizeTimestamp(evidence['reviewedAt']) !== null
    && String(evidence['reviewedBy'] ?? '').trim().length > 0;
}

/**
 * OBSERVE_ONLY nunca sai sozinho.
 *
 * Mesmo evidência completa apenas torna a mudança elegível para revisão. O
 * runtime pago continua bloqueado pelo kill switch explícito acima.
 */
export function isVideoPromotionCalibrationChangeReviewable(
  evidence: unknown
): boolean {
  return String(VIDEO_PROMOTION_CALIBRATION_STAGE) === 'OBSERVE_ONLY'
    && isVideoPromotionExitEvidenceReady(evidence);
}
