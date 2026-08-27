import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildVideoRetentionAggregate,
  calculateVideoRetentionBasisPoints,
} from './video-retention-score';

describe('video-retention-score', () => {
  it('normaliza progresso reproduzido em basis points', () => {
    assert.equal(calculateVideoRetentionBasisPoints(5_000, 10_000), 5_000);
    assert.equal(calculateVideoRetentionBasisPoints(15_000, 10_000), 10_000);
    assert.equal(calculateVideoRetentionBasisPoints(-1, 10_000), 0);
  });

  it('adiciona um viewer somente uma vez e usa o melhor progresso', () => {
    const first = buildVideoRetentionAggregate({
      currentContributorsCount: 0,
      currentBasisPointsTotal: 0,
      currentCompletionViewersCount: 0,
      previousViewerBasisPoints: 0,
      playbackMs: 2_500,
      durationMs: 10_000,
    });
    const improved = buildVideoRetentionAggregate({
      currentContributorsCount: first.contributorsCount,
      currentBasisPointsTotal: first.basisPointsTotal,
      currentCompletionViewersCount: first.completionViewersCount,
      previousViewerBasisPoints: first.viewerBasisPoints,
      playbackMs: 7_500,
      durationMs: 10_000,
    });

    assert.equal(first.contributorsCount, 1);
    assert.equal(first.viewerBasisPoints, 2_500);
    assert.equal(improved.contributorsCount, 1);
    assert.equal(improved.viewerBasisPoints, 7_500);
    assert.equal(improved.basisPointsTotal, 7_500);
  });

  it('não infla o agregado quando o mesmo progresso é reenviado', () => {
    const repeated = buildVideoRetentionAggregate({
      currentContributorsCount: 3,
      currentBasisPointsTotal: 18_000,
      currentCompletionViewersCount: 1,
      previousViewerBasisPoints: 7_500,
      playbackMs: 7_000,
      durationMs: 10_000,
    });

    assert.equal(repeated.improved, false);
    assert.equal(repeated.contributorsCount, 3);
    assert.equal(repeated.basisPointsTotal, 18_000);
    assert.equal(repeated.completionViewersCount, 1);
  });

  it('contabiliza conclusão apenas ao cruzar 90%', () => {
    const completed = buildVideoRetentionAggregate({
      currentContributorsCount: 1,
      currentBasisPointsTotal: 7_500,
      currentCompletionViewersCount: 0,
      previousViewerBasisPoints: 7_500,
      playbackMs: 9_100,
      durationMs: 10_000,
    });

    assert.equal(completed.completionViewersCount, 1);
    assert.equal(completed.completionRate, 100);
  });

  it('reduz impacto de amostras muito pequenas no ranking', () => {
    const oneViewer = buildVideoRetentionAggregate({
      currentContributorsCount: 0,
      currentBasisPointsTotal: 0,
      currentCompletionViewersCount: 0,
      previousViewerBasisPoints: 0,
      playbackMs: 10_000,
      durationMs: 10_000,
    });
    const fiveViewers = buildVideoRetentionAggregate({
      currentContributorsCount: 4,
      currentBasisPointsTotal: 40_000,
      currentCompletionViewersCount: 4,
      previousViewerBasisPoints: 0,
      playbackMs: 10_000,
      durationMs: 10_000,
    });

    assert.equal(oneViewer.averagePercent, 100);
    assert.equal(oneViewer.retentionScore, 20);
    assert.equal(fiveViewers.retentionScore, 100);
  });
});
