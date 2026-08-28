import { describe, expect, it } from 'vitest';

import {
  buildNextExploreOwnerBatch,
  hasUnusedExploreOwners,
} from './explore-owner-pool';

describe('buildNextExploreOwnerBatch', () => {
  it('prioriza até oito amigos e completa o lote com compatíveis', () => {
    const friends = Array.from({ length: 10 }, (_, index) => `friend-${index + 1}`);
    const compatibles = Array.from(
      { length: 8 },
      (_, index) => `compatible-${index + 1}`
    );

    expect(buildNextExploreOwnerBatch(friends, compatibles, [])).toEqual([
      'friend-1',
      'friend-2',
      'friend-3',
      'friend-4',
      'friend-5',
      'friend-6',
      'friend-7',
      'friend-8',
      'compatible-1',
      'compatible-2',
      'compatible-3',
      'compatible-4',
    ]);
  });

  it('usa amigos excedentes quando faltam compatíveis para completar o lote', () => {
    const friends = Array.from({ length: 12 }, (_, index) => `friend-${index + 1}`);

    expect(
      buildNextExploreOwnerBatch(friends, ['compatible-1'], [])
    ).toEqual([
      'friend-1',
      'friend-2',
      'friend-3',
      'friend-4',
      'friend-5',
      'friend-6',
      'friend-7',
      'friend-8',
      'compatible-1',
      'friend-9',
      'friend-10',
      'friend-11',
    ]);
  });

  it('exclui autores já consultados e produz o lote seguinte sem repetição', () => {
    const friends = Array.from({ length: 12 }, (_, index) => `friend-${index + 1}`);
    const compatibles = Array.from(
      { length: 12 },
      (_, index) => `compatible-${index + 1}`
    );
    const first = buildNextExploreOwnerBatch(friends, compatibles, []);
    const second = buildNextExploreOwnerBatch(friends, compatibles, first);

    expect(first).toHaveLength(12);
    expect(second).toEqual([
      'friend-9',
      'friend-10',
      'friend-11',
      'friend-12',
      'compatible-5',
      'compatible-6',
      'compatible-7',
      'compatible-8',
      'compatible-9',
      'compatible-10',
      'compatible-11',
      'compatible-12',
    ]);
    expect(new Set([...first, ...second]).size).toBe(24);
    expect(hasUnusedExploreOwners(friends, compatibles, [...first, ...second])).toBe(false);
  });
});
