import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MEDIA_FRESHNESS_HALF_LIFE_MS,
  buildMediaEngagementScore,
  calculateMediaFreshnessScore,
  calculateMediaRetentionScore,
  calculateMediaViewScore,
  normalizeMediaCount,
  normalizeMediaRatingAverage,
  normalizeMediaScore,
} from './media-engagement-score';

describe('media-engagement-score', () => {
  it('normaliza contadores, médias e scores inválidos', () => {
    assert.equal(normalizeMediaCount(-2), 0);
    assert.equal(normalizeMediaCount(3.9), 3);
    assert.equal(normalizeMediaRatingAverage(8), 5);
    assert.equal(normalizeMediaRatingAverage(Number.NaN), 0);
    assert.equal(normalizeMediaScore(140), 100);
    assert.equal(normalizeMediaScore(Number.NaN), 0);
  });

  it('aumenta o engajamento com curtidas e comentários', () => {
    const empty = buildMediaEngagementScore({
      reactionsCount: 0,
      commentsCount: 0,
    });
    const engaged = buildMediaEngagementScore({
      reactionsCount: 4,
      commentsCount: 2,
    });

    assert.equal(empty.engagementScore, 0);
    assert.ok(engaged.engagementScore > empty.engagementScore);
    assert.equal(engaged.score, engaged.scoreBreakdown.rankingScore);
  });

  it('considera quantidade e média das avaliações', () => {
    const withoutRatings = buildMediaEngagementScore({
      reactionsCount: 1,
      commentsCount: 0,
      ratingsCount: 0,
      ratingAverage: 0,
    });
    const withRatings = buildMediaEngagementScore({
      reactionsCount: 1,
      commentsCount: 0,
      ratingsCount: 4,
      ratingAverage: 4.5,
    });

    assert.ok(withRatings.engagementScore > withoutRatings.engagementScore);
  });

  it('normaliza visualizações sem saturar na primeira reprodução', () => {
    const firstView = calculateMediaViewScore({
      viewsCount: 1,
      uniqueViewersCount: 1,
    });
    const establishedVideo = calculateMediaViewScore({
      viewsCount: 1_000,
      uniqueViewersCount: 700,
    });

    assert.ok(firstView > 0);
    assert.ok(firstView < 20);
    assert.ok(establishedVideo > firstView);
    assert.ok(establishedVideo <= 100);
  });

  it('pondera retenção pela quantidade de visualizações qualificadas', () => {
    const oneView = calculateMediaRetentionScore({
      qualifiedViewsCount: 1,
      totalQualifiedPlaybackMs: 8_000,
      totalQualifiedDurationMs: 10_000,
    });
    const established = calculateMediaRetentionScore({
      qualifiedViewsCount: 30,
      totalQualifiedPlaybackMs: 240_000,
      totalQualifiedDurationMs: 300_000,
    });

    assert.ok(oneView > 0);
    assert.ok(oneView < established);
    assert.ok(established <= 80);
  });

  it('reduz a recência conforme o vídeo envelhece', () => {
    const now = 2_000_000_000_000;
    const fresh = calculateMediaFreshnessScore({
      publishedAt: now,
      now,
    });
    const halfLife = calculateMediaFreshnessScore({
      publishedAt: now - MEDIA_FRESHNESS_HALF_LIFE_MS,
      now,
    });
    const old = calculateMediaFreshnessScore({
      publishedAt: now - MEDIA_FRESHNESS_HALF_LIFE_MS * 4,
      now,
    });

    assert.equal(fresh, 100);
    assert.equal(halfLife, 50);
    assert.ok(old < halfLife);
  });

  it('preserva qualidade e segurança e integra views, retenção e recência', () => {
    const now = 2_000_000_000_000;
    const result = buildMediaEngagementScore({
      reactionsCount: 4,
      commentsCount: 2,
      ratingsCount: 3,
      ratingAverage: 4.5,
      viewsCount: 100,
      uniqueViewersCount: 80,
      qualifiedViewsCount: 30,
      totalQualifiedPlaybackMs: 240_000,
      totalQualifiedDurationMs: 300_000,
      publishedAt: now - 24 * 60 * 60 * 1000,
      now,
      currentBreakdown: {
        qualityScore: 72,
        safetyScore: 84,
      },
    });

    assert.equal(result.scoreBreakdown.qualityScore, 72);
    assert.equal(result.scoreBreakdown.safetyScore, 84);
    assert.equal(result.viewScore, result.scoreBreakdown.viewScore);
    assert.equal(result.retentionScore, result.scoreBreakdown.retentionScore);
    assert.equal(result.freshnessScore, result.scoreBreakdown.freshnessScore);
    assert.ok(result.score > 0);
  });

  it('não entrega bônus de segurança sem evidência de qualidade ou consumo', () => {
    const result = buildMediaEngagementScore({
      reactionsCount: 0,
      commentsCount: 0,
      publishedAt: 1_999_999_000_000,
      now: 2_000_000_000_000,
      currentBreakdown: {
        safetyScore: 100,
      },
    });

    assert.equal(result.score, result.freshnessScore * 0.1);
  });
});
