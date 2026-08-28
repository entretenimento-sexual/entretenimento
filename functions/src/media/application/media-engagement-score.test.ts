import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { calculateMediaViewScore } from './media-audience-score';
import {
  buildMediaEngagementScore,
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

  it('calcula audiência bruta somente por views e viewers únicos', () => {
    assert.equal(calculateMediaViewScore({
      viewsCount: 10,
      uniqueViewersCount: 4,
    }), 64);
    assert.equal(calculateMediaViewScore({
      viewsCount: -5,
      uniqueViewersCount: Number.NaN,
    }), 0);
  });

  it('mantém o score bruto de audiência independente da idade da publicação', () => {
    const score = calculateMediaViewScore({
      viewsCount: 8,
      uniqueViewersCount: 3,
    });

    assert.equal(score, 50);
    assert.equal(
      score,
      calculateMediaViewScore({
        viewsCount: 8,
        uniqueViewersCount: 3,
      })
    );
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

  it('preserva qualidade e segurança do breakdown atual', () => {
    const result = buildMediaEngagementScore({
      reactionsCount: 1,
      commentsCount: 1,
      ratingsCount: 1,
      ratingAverage: 5,
      currentBreakdown: {
        qualityScore: 72,
        safetyScore: 84,
      },
    });

    assert.equal(result.scoreBreakdown.qualityScore, 72);
    assert.equal(result.scoreBreakdown.safetyScore, 84);
    assert.ok(result.score > 0);
  });

  it('preserva a fórmula histórica quando não existe sinal de vídeo', () => {
    const result = buildMediaEngagementScore({
      reactionsCount: 0,
      commentsCount: 0,
      currentBreakdown: {
        qualityScore: 80,
        safetyScore: 100,
      },
    });

    assert.equal(result.scoreBreakdown.audienceScore, undefined);
    assert.equal(result.scoreBreakdown.retentionScore, undefined);
    assert.equal(result.score, 50);
  });

  it('compõe audiência qualificada no ranking de vídeo sem reduzir segurança', () => {
    const withoutAudience = buildMediaEngagementScore({
      reactionsCount: 0,
      commentsCount: 0,
      currentBreakdown: {
        qualityScore: 0,
        safetyScore: 100,
      },
    });
    const withAudience = buildMediaEngagementScore({
      reactionsCount: 0,
      commentsCount: 0,
      currentBreakdown: {
        qualityScore: 0,
        safetyScore: 100,
        audienceScore: 80,
      },
    });

    assert.equal(withAudience.scoreBreakdown.audienceScore, 80);
    assert.equal(withAudience.scoreBreakdown.safetyScore, 100);
    assert.ok(withAudience.score > withoutAudience.score);
  });

  it('preserva audiência e acrescenta retenção confiável ao ranking de vídeo', () => {
    const audienceOnly = buildMediaEngagementScore({
      reactionsCount: 2,
      commentsCount: 1,
      currentBreakdown: {
        qualityScore: 70,
        safetyScore: 100,
        audienceScore: 60,
      },
    });
    const withRetention = buildMediaEngagementScore({
      reactionsCount: 2,
      commentsCount: 1,
      currentBreakdown: {
        qualityScore: 70,
        safetyScore: 100,
        audienceScore: 60,
        retentionScore: 90,
      },
    });

    assert.equal(withRetention.scoreBreakdown.audienceScore, 60);
    assert.equal(withRetention.scoreBreakdown.retentionScore, 90);
    assert.equal(withRetention.scoreBreakdown.safetyScore, 100);
    assert.ok(withRetention.score > audienceOnly.score);
  });
});
