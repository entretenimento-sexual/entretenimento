import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PHOTO_RANKING_MAX_VISIBLE_SAMPLE_MS,
  PHOTO_RANKING_QUALIFIED_VISIBLE_TARGET_MS,
  buildNextPhotoQualificationMetrics,
  buildPhotoRankingUpdate,
  hasEquivalentPhotoRanking,
  normalizePhotoQualifiedVisibleMs,
} from './photo-ranking-score';

describe('photo-ranking-score', () => {
  it('limita uma amostra de permanência para evitar distorção', () => {
    assert.equal(normalizePhotoQualifiedVisibleMs(-1), 0);
    assert.equal(normalizePhotoQualifiedVisibleMs(2_500), 2_500);
    assert.equal(
      normalizePhotoQualifiedVisibleMs(120_000),
      PHOTO_RANKING_MAX_VISIBLE_SAMPLE_MS
    );
  });

  it('acumula visualização qualificada com meta estável', () => {
    const metrics = buildNextPhotoQualificationMetrics({
      currentQualifiedViewsCount: 2,
      currentTotalQualifiedVisibleMs: 12_000,
      currentTotalQualifiedTargetMs: 16_000,
      visibleMs: 10_000,
      counted: true,
    });

    assert.deepEqual(metrics, {
      qualifiedViewsCount: 3,
      totalQualifiedVisibleMs: 22_000,
      totalQualifiedTargetMs:
        16_000 + PHOTO_RANKING_QUALIFIED_VISIBLE_TARGET_MS,
      averageQualifiedVisibleMs: 7_333,
    });
  });

  it('não altera métricas quando a janela antifraude bloqueia a contagem', () => {
    const metrics = buildNextPhotoQualificationMetrics({
      currentQualifiedViewsCount: 4,
      currentTotalQualifiedVisibleMs: 24_000,
      currentTotalQualifiedTargetMs: 32_000,
      visibleMs: 8_000,
      counted: false,
    });

    assert.deepEqual(metrics, {
      qualifiedViewsCount: 4,
      totalQualifiedVisibleMs: 24_000,
      totalQualifiedTargetMs: 32_000,
      averageQualifiedVisibleMs: 6_000,
    });
  });

  it('combina audiência única, permanência, recência e engajamento', () => {
    const now = 1_800_000_000_000;
    const ranking = buildPhotoRankingUpdate(
      {
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
        reactionsCount: 12,
        commentsCount: 4,
        viewsCount: 40,
        uniqueViewersCount: 30,
        qualifiedViewsCount: 30,
        totalQualifiedVisibleMs: 210_000,
        totalQualifiedTargetMs: 240_000,
        publishedAt: now - 24 * 60 * 60 * 1000,
        scoreBreakdown: {
          qualityScore: 65,
          safetyScore: 100,
        },
      },
      now
    );

    assert.ok(ranking.score > 0);
    assert.ok(ranking.viewScore > 0);
    assert.ok(ranking.retentionScore > 0);
    assert.ok(ranking.freshnessScore > 0);
    assert.equal(ranking.score, ranking.scoreBreakdown.rankingScore);
    assert.equal(ranking.averageQualifiedVisibleMs, 7_000);
    assert.equal(hasEquivalentPhotoRanking({
      ...ranking,
      visibility: 'PUBLIC',
      moderationStatus: 'APPROVED',
    }, ranking), true);
  });

  it('reduz recência sem apagar evidências acumuladas', () => {
    const publishedAt = 1_700_000_000_000;
    const recent = buildPhotoRankingUpdate({
      reactionsCount: 3,
      commentsCount: 1,
      viewsCount: 10,
      uniqueViewersCount: 8,
      qualifiedViewsCount: 8,
      totalQualifiedVisibleMs: 48_000,
      totalQualifiedTargetMs: 64_000,
      publishedAt,
    }, publishedAt + 60_000);
    const old = buildPhotoRankingUpdate({
      reactionsCount: 3,
      commentsCount: 1,
      viewsCount: 10,
      uniqueViewersCount: 8,
      qualifiedViewsCount: 8,
      totalQualifiedVisibleMs: 48_000,
      totalQualifiedTargetMs: 64_000,
      publishedAt,
    }, publishedAt + 30 * 24 * 60 * 60 * 1000);

    assert.ok(recent.freshnessScore > old.freshnessScore);
    assert.equal(recent.viewScore, old.viewScore);
    assert.equal(recent.retentionScore, old.retentionScore);
  });
});
