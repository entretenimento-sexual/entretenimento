import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateVideoViewScore,
  normalizeVideoAudienceScore,
} from './video-audience-score';

describe('video-audience-score', () => {
  it('pondera visualizadores únicos acima de repetições qualificadas', () => {
    assert.equal(
      calculateVideoViewScore({ viewsCount: 10, uniqueViewersCount: 10 }),
      100
    );
    assert.equal(
      calculateVideoViewScore({ viewsCount: 10, uniqueViewersCount: 2 }),
      52
    );
  });

  it('não recompensa idade, timestamp ou valores inválidos', () => {
    assert.equal(
      calculateVideoViewScore({ viewsCount: -1, uniqueViewersCount: NaN }),
      0
    );
    assert.equal(
      calculateVideoViewScore({ viewsCount: 1, uniqueViewersCount: 1 }),
      10
    );
  });

  it('normaliza audiência com retorno decrescente e teto de 100', () => {
    const small = normalizeVideoAudienceScore(10);
    const medium = normalizeVideoAudienceScore(100);
    const large = normalizeVideoAudienceScore(1_000);
    const massive = normalizeVideoAudienceScore(1_000_000_000);

    assert.ok(small > 0);
    assert.ok(medium > small);
    assert.ok(large > medium);
    assert.equal(massive, 100);
  });
});
