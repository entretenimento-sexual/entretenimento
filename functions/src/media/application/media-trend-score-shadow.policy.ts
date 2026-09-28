// functions/src/media/application/media-trend-score-shadow.policy.ts
// -----------------------------------------------------------------------------
// MEDIA TREND SCORE — SHADOW ONLY
// -----------------------------------------------------------------------------
// Candidato temporal separado de engagementScore/rankingScore.
//
// Invariantes:
// - nunca altera score/ranking/discovery;
// - nunca altera notification cadence;
// - nunca altera Promotion/Boost, preço ou limites comerciais;
// - não persiste estado adicional no Firestore;
// - só pode produzir observações de runtime enquanto o produto estiver em
//   OBSERVE_ONLY;
// - qualquer ativação futura exige evidência real + decisão explícita.
// -----------------------------------------------------------------------------

import {
  PRODUCT_CALIBRATION_REQUIRED_EVIDENCE,
  PRODUCT_CALIBRATION_STAGE,
  isProductCalibrationChangeAllowed,
} from '../../shared/calibration/product-calibration-stage.policy';
import { normalizeMediaScore } from './media-engagement-score';

export const MEDIA_TREND_SCORE_MODEL_VERSION = 1 as const;
export const MEDIA_TREND_SCORE_FRESHNESS_WINDOW_HOURS = 24 as const;
export const MEDIA_TREND_SCORE_RUNTIME_METRIC =
  'media.trend_score_shadow' as const;

export type MediaTrendScoreCalibrationStage =
  typeof PRODUCT_CALIBRATION_STAGE;

export interface MediaTrendScoreShadowInput {
  readonly engagementScore: unknown;
  readonly publishedAt: unknown;
  readonly now: unknown;
}

export interface MediaTrendScoreShadow {
  readonly trendScore: number;
  readonly modelVersion: typeof MEDIA_TREND_SCORE_MODEL_VERSION;
  readonly calibrationStage: MediaTrendScoreCalibrationStage;
  readonly observationOnly: true;
  readonly eligibleForRanking: false;
  readonly eligibleForNotifications: false;
  readonly eligibleForCommercialUse: false;
}

export interface MediaTrendScoreReviewReadinessInput {
  readonly productionWindowDays: unknown;
  readonly observedDays: unknown;
  readonly sampleCount: unknown;
  readonly source: unknown;
}

export interface MediaTrendScoreReviewReadiness {
  readonly reviewEligible: boolean;
  readonly canActivate: boolean;
  readonly missingEvidence: readonly string[];
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? Math.floor(parsed)
    : 0;
}

function epoch(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : null;
}

export function buildMediaTrendScoreShadow(
  input: MediaTrendScoreShadowInput
): Readonly<MediaTrendScoreShadow> {
  const engagementScore = normalizeMediaScore(input.engagementScore);
  const publishedAt = epoch(input.publishedAt);
  const now = epoch(input.now);
  const ageHours = !publishedAt || !now
    ? Number.POSITIVE_INFINITY
    : Math.max(0, (now - publishedAt) / (60 * 60 * 1_000));

  // V1 shadow: não redefine pesos de engagement. Apenas aplica um fator
  // temporal independente ao engagementScore já calculado pela policy atual.
  const freshnessScore = Number.isFinite(ageHours)
    ? normalizeMediaScore(
      Math.round(
        100 / (
          1 + ageHours / MEDIA_TREND_SCORE_FRESHNESS_WINDOW_HOURS
        )
      )
    )
    : 0;
  const trendScore = normalizeMediaScore(
    Math.round(Math.sqrt(engagementScore * freshnessScore))
  );

  return Object.freeze({
    trendScore,
    modelVersion: MEDIA_TREND_SCORE_MODEL_VERSION,
    calibrationStage: PRODUCT_CALIBRATION_STAGE,
    observationOnly: true,
    eligibleForRanking: false,
    eligibleForNotifications: false,
    eligibleForCommercialUse: false,
  });
}

export function evaluateMediaTrendScoreReviewReadiness(
  input: MediaTrendScoreReviewReadinessInput
): Readonly<MediaTrendScoreReviewReadiness> {
  const missing: string[] = [];
  const productionWindowDays = nonNegativeInteger(input.productionWindowDays);
  const observedDays = nonNegativeInteger(input.observedDays);
  const sampleCount = nonNegativeInteger(input.sampleCount);

  if (
    productionWindowDays <
      PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumProductionWindowDays
  ) {
    missing.push('production_window');
  }

  if (input.source !== 'cloud_logging_runtime_events') {
    missing.push('production_runtime_source');
  }

  if (
    observedDays <
      PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumObservedDaysPerRuntimeMetric
  ) {
    missing.push('observed_days');
  }

  if (
    sampleCount <
      PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumRuntimeSamplesPerMetric
  ) {
    missing.push('runtime_samples');
  }

  const reviewEligible = missing.length === 0;

  return Object.freeze({
    reviewEligible,
    canActivate:
      reviewEligible && isProductCalibrationChangeAllowed(),
    missingEvidence: Object.freeze(missing),
  });
}
