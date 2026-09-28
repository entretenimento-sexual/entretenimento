import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MEDIA_TREND_SCORE_MODEL_VERSION,
  buildMediaTrendScoreShadow,
  evaluateMediaTrendScoreReviewReadiness,
} from './media-trend-score-shadow.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

describe('media-trend-score-shadow.policy', () => {
  it('mantém trendScore separado e inelegível para produto', () => {
    const shadow = buildMediaTrendScoreShadow({
      engagementScore: 81,
      publishedAt: NOW - DAY_MS,
      now: NOW,
    });

    assert.equal(shadow.modelVersion, MEDIA_TREND_SCORE_MODEL_VERSION);
    assert.equal(shadow.calibrationStage, 'OBSERVE_ONLY');
    assert.equal(shadow.observationOnly, true);
    assert.equal(shadow.eligibleForRanking, false);
    assert.equal(shadow.eligibleForNotifications, false);
    assert.equal(shadow.eligibleForCommercialUse, false);
    assert.ok(shadow.trendScore > 0);
    assert.ok(shadow.trendScore <= 100);
  });

  it('aplica somente fator temporal ao engagementScore canônico', () => {
    const fresh = buildMediaTrendScoreShadow({
      engagementScore: 64,
      publishedAt: NOW - 60 * 60 * 1_000,
      now: NOW,
    });
    const old = buildMediaTrendScoreShadow({
      engagementScore: 64,
      publishedAt: NOW - 30 * DAY_MS,
      now: NOW,
    });

    assert.ok(fresh.trendScore > old.trendScore);
  });

  it('falha fechado quando não há publicação temporal válida', () => {
    const shadow = buildMediaTrendScoreShadow({
      engagementScore: 100,
      publishedAt: null,
      now: NOW,
    });

    assert.equal(shadow.trendScore, 0);
  });

  it('evidência real habilita revisão, nunca ativação em OBSERVE_ONLY', () => {
    const readiness = evaluateMediaTrendScoreReviewReadiness({
      productionWindowDays: 30,
      observedDays: 14,
      sampleCount: 1_000,
      source: 'cloud_logging_runtime_events',
    });

    assert.equal(readiness.reviewEligible, true);
    assert.equal(readiness.canActivate, false);
    assert.deepEqual(readiness.missingEvidence, []);
  });

  it('rejeita evidência insuficiente ou não-runtime', () => {
    const readiness = evaluateMediaTrendScoreReviewReadiness({
      productionWindowDays: 5,
      observedDays: 2,
      sampleCount: 10,
      source: 'fixture',
    });

    assert.equal(readiness.reviewEligible, false);
    assert.equal(readiness.canActivate, false);
    assert.ok(readiness.missingEvidence.includes('production_window'));
    assert.ok(readiness.missingEvidence.includes('production_runtime_source'));
    assert.ok(readiness.missingEvidence.includes('observed_days'));
    assert.ok(readiness.missingEvidence.includes('runtime_samples'));
  });
});
