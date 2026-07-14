import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

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
});
