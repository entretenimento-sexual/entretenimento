import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildMediaEngagementScore,
  normalizeMediaCount,
  normalizeMediaScore,
} from './media-engagement-score';

describe('media-engagement-score', () => {
  it('normaliza contadores e scores inválidos', () => {
    assert.equal(normalizeMediaCount(-2), 0);
    assert.equal(normalizeMediaCount(3.9), 3);
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

  it('preserva qualidade e segurança do breakdown atual', () => {
    const result = buildMediaEngagementScore({
      reactionsCount: 1,
      commentsCount: 1,
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
