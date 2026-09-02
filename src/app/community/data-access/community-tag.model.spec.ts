// src/app/community/data-access/community-tag.model.spec.ts
import { describe, expect, it } from 'vitest';

import { normalizeCommunityTagCatalog } from './community-tag.model';

describe('normalizeCommunityTagCatalog', () => {
  it('normaliza somente tags canônicas e remove duplicidades', () => {
    const result = normalizeCommunityTagCatalog({
      items: [
        { id: 'intent:friendship', label: 'Amizade', category: 'intent' },
        { id: 'intent:friendship', label: 'Amizade duplicada', category: 'intent' },
        { id: 'practice:bdsm', label: 'BDSM', category: 'practice' },
        { id: 'audience:couple_mf', label: 'Casal MF', category: 'audience' },
      ],
      generatedAt: 123,
    });

    expect(result.items).toEqual([
      {
        id: 'intent:friendship',
        label: 'Amizade duplicada',
        category: 'intent',
        preferenceSignals: [],
      },
      {
        id: 'practice:bdsm',
        label: 'BDSM',
        category: 'practice',
        preferenceSignals: [],
      },
      {
        id: 'audience:couple_mf',
        label: 'Casal MF',
        category: 'audience',
        preferenceSignals: [],
      },
    ]);
    expect(result.generatedAt).toBe(123);
  });

  it('descarta IDs, categorias e rótulos inválidos', () => {
    const result = normalizeCommunityTagCatalog({
      items: [
        { id: 'unknown:value', label: 'Inválida', category: 'intent' },
        { id: 'intent:friendship', label: '', category: 'intent' },
        { id: 'intent:friendship', label: 'Amizade', category: 'unknown' },
      ],
    });

    expect(result.items).toEqual([]);
  });
});
