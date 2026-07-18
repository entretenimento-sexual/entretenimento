import { describe, expect, it } from 'vitest';

import { normalizeExclusiveConnectionsPageResponse } from './exclusive-connections.model';

function createCard(overrides: Record<string, unknown> = {}) {
  return {
    candidateUid: 'candidate-1',
    nickname: 'Pessoa Teste',
    photoURL: 'https://example.com/photo.jpg',
    region: { uf: 'RJ', city: 'Niterói' },
    compatibilityScore: 87.6,
    intentLabel: 'Disponível hoje',
    reasonTags: ['Mesma região', 'Interesses próximos', 'Mesma região'],
    ...overrides,
  };
}

describe('normalizeExclusiveConnectionsPageResponse', () => {
  it('normaliza uma página válida e remove tags duplicadas', () => {
    expect(
      normalizeExclusiveConnectionsPageResponse({
        items: [createCard()],
        nextCursor: 'candidate-1',
        generatedAt: 123,
      })
    ).toEqual({
      items: [
        {
          candidateUid: 'candidate-1',
          nickname: 'Pessoa Teste',
          photoURL: 'https://example.com/photo.jpg',
          region: { uf: 'RJ', city: 'Niterói' },
          compatibilityScore: 88,
          intentLabel: 'Disponível hoje',
          reasonTags: ['Mesma região', 'Interesses próximos'],
        },
      ],
      nextCursor: 'candidate-1',
      generatedAt: 123,
    });
  });

  it('descarta cards com UID, região ou score inválidos', () => {
    const page = normalizeExclusiveConnectionsPageResponse({
      items: [
        createCard({ candidateUid: '../unsafe' }),
        createCard({ region: { uf: 'R', city: '' } }),
        createCard({ compatibilityScore: 101 }),
      ],
      generatedAt: 123,
    });

    expect(page.items).toEqual([]);
  });

  it('remove URL não HTTPS sem descartar o card', () => {
    const page = normalizeExclusiveConnectionsPageResponse({
      items: [createCard({ photoURL: 'http://example.com/photo.jpg' })],
      generatedAt: 123,
    });

    expect(page.items[0]?.photoURL).toBeNull();
  });

  it('ignora cursor inseguro', () => {
    const page = normalizeExclusiveConnectionsPageResponse({
      items: [],
      nextCursor: '//example.com',
      generatedAt: 123,
    });

    expect(page.nextCursor).toBeNull();
  });

  it('falha fechada para payload ausente ou inesperado', () => {
    const before = Date.now();
    const page = normalizeExclusiveConnectionsPageResponse(null);

    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
    expect(page.generatedAt).toBeGreaterThanOrEqual(before);
  });
});
