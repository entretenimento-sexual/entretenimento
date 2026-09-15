import { describe, expect, it } from 'vitest';

import { normalizeCommunityOwnershipCandidatesResponse } from './community-ownership.model';

describe('community ownership model', () => {
  it('preserva cursor válido para continuar a busca de sucessores', () => {
    const result = normalizeCommunityOwnershipCandidatesResponse({
      items: [
        {
          uid: 'member-1',
          label: 'Pessoa Um',
          avatarUrl: null,
          role: 'member',
        },
      ],
      nextCursor: 'member-050',
      generatedAt: 1,
    });

    expect(result?.nextCursor).toBe('member-050');
    expect(result?.items).toHaveLength(1);
  });

  it('aceita fim de paginação explícito', () => {
    const result = normalizeCommunityOwnershipCandidatesResponse({
      items: [],
      nextCursor: null,
      generatedAt: 1,
    });

    expect(result?.nextCursor).toBeNull();
  });

  it('falha fechado quando o backend devolve cursor inválido', () => {
    expect(
      normalizeCommunityOwnershipCandidatesResponse({
        items: [],
        nextCursor: 'cursor inválido',
        generatedAt: 1,
      })
    ).toBeNull();
  });
});
