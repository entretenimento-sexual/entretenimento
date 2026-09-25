import { describe, expect, it } from 'vitest';

import {
  buildCommunityBoundedRenderWindow,
  communityRenderWindowStartForIndex,
  communityTailRenderWindowStart,
  normalizeCommunityRenderWindowStart,
} from './community-bounded-render-window.util';

describe('community bounded render window', () => {
  it('mantém listas pequenas integralmente visíveis', () => {
    const window = buildCommunityBoundedRenderWindow(
      ['a', 'b', 'c'],
      6,
      99
    );

    expect(window.start).toBe(0);
    expect(window.items).toEqual(['a', 'b', 'c']);
    expect(window.hasPrevious).toBe(false);
    expect(window.hasNext).toBe(false);
  });

  it('limita o DOM sem perder a ordem dos itens carregados', () => {
    const items = Array.from({ length: 20 }, (_, index) => index);
    const window = buildCommunityBoundedRenderWindow(items, 6, 7);

    expect(window.start).toBe(7);
    expect(window.items).toEqual([7, 8, 9, 10, 11, 12]);
    expect(window.hasPrevious).toBe(true);
    expect(window.hasNext).toBe(true);
  });

  it('calcula a cauda e impede início fora do intervalo válido', () => {
    expect(communityTailRenderWindowStart(20, 6)).toBe(14);
    expect(normalizeCommunityRenderWindowStart(20, 6, 999)).toBe(14);
    expect(normalizeCommunityRenderWindowStart(4, 6, 3)).toBe(0);
  });

  it('revela um item carregado dentro de uma janela estável', () => {
    const start = communityRenderWindowStartForIndex(100, 60, 75);

    expect(start).toBe(40);
    expect(75).toBeGreaterThanOrEqual(start);
    expect(75).toBeLessThan(start + 60);
  });
});
