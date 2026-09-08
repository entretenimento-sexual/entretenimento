import { describe, expect, it } from 'vitest';

import { normalizeCommunityMemberRosterPage } from './community-member-roster.model';

describe('normalizeCommunityMemberRosterPage', () => {
  it('normaliza somente identidade pública mínima e papel comunitário', () => {
    const page = normalizeCommunityMemberRosterPage({
      items: [
        {
          memberKey: 'uM6ahxYpF1RkL8qvW2N3Zw',
          identity: {
            nickname: 'Perfil Teste',
            label: 'Perfil Teste',
            avatarUrl: 'https://example.com/avatar.webp',
            uid: 'nao-deve-ser-transportado',
          },
          role: 'moderator',
        },
      ],
      nextCursor: 'roster1:YWJjMTIz',
      memberCount: 23,
      generatedAt: 123456,
    });

    expect(page).not.toBeNull();
    expect(page?.items).toHaveLength(1);
    expect(page?.items[0].role).toBe('moderator');
    expect(page?.items[0].identity.nickname).toBe('Perfil Teste');
    expect((page?.items[0].identity as { uid?: unknown }).uid).toBeUndefined();
  });

  it('descarta itens inválidos sem derrubar os demais integrantes', () => {
    const page = normalizeCommunityMemberRosterPage({
      items: [
        {
          memberKey: 'membroValido_123456',
          identity: { nickname: 'Pessoa Válida', label: 'Pessoa Válida' },
          role: 'member',
        },
        {
          memberKey: 'curto',
          identity: { nickname: 'Pessoa Inválida', label: 'Pessoa Inválida' },
          role: 'owner',
        },
      ],
      nextCursor: null,
      memberCount: 2,
      generatedAt: 123456,
    });

    expect(page?.items).toHaveLength(1);
    expect(page?.items[0].identity.nickname).toBe('Pessoa Válida');
  });

  it('falha fechado quando o cursor não obedece ao contrato', () => {
    expect(
      normalizeCommunityMemberRosterPage({
        items: [],
        nextCursor: '../uid-interno',
        memberCount: 0,
        generatedAt: 123456,
      })
    ).toBeNull();
  });
});
