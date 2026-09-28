// functions/src/media/application/media-trend-score-shadow-observation.service.ts
// -----------------------------------------------------------------------------
// MEDIA TREND SCORE — RUNTIME SHADOW OBSERVATION
// -----------------------------------------------------------------------------
// Emite somente telemetria não identificável no Cloud Logging.
// Nenhum documento extra é criado e nenhum consumer recebe o trendScore.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';

import {
  buildProductCalibrationRuntimeObservation,
} from '../../shared/observability/product-calibration-observation.policy';
import {
  MEDIA_TREND_SCORE_RUNTIME_METRIC,
  buildMediaTrendScoreShadow,
} from './media-trend-score-shadow.policy';

export type MediaTrendScoreShadowEvent =
  | 'reaction'
  | 'comment'
  | 'rating';

export type MediaTrendScoreShadowMediaType = 'photo' | 'video';

export function observeMediaTrendScoreShadow(input: {
  readonly mediaType: MediaTrendScoreShadowMediaType;
  readonly event: MediaTrendScoreShadowEvent;
  readonly engagementScore: unknown;
  readonly publishedAt: unknown;
  readonly now: number;
}): void {
  const shadow = buildMediaTrendScoreShadow({
    engagementScore: input.engagementScore,
    publishedAt: input.publishedAt,
    now: input.now,
  });
  const observation = buildProductCalibrationRuntimeObservation({
    metric: MEDIA_TREND_SCORE_RUNTIME_METRIC,
    value: shadow.trendScore,
    source: `media.${input.mediaType}.${input.event}`,
  });

  logger.info('media_trend_score_shadow_observed', {
    ...observation,
    modelVersion: shadow.modelVersion,
    calibrationStage: shadow.calibrationStage,
    observationOnly: shadow.observationOnly,
    eligibleForRanking: shadow.eligibleForRanking,
    eligibleForNotifications: shadow.eligibleForNotifications,
    eligibleForCommercialUse: shadow.eligibleForCommercialUse,
  });
}
