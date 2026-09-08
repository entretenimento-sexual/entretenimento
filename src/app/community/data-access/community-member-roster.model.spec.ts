import { describe, expect, it } from 'vitest';

import { normalizeCommunityMemberRosterPage } from './community-member-roster.model';

const PROFILE_ID = 'profile-123e4567-e89b-42d3-a456-426614174000';
const NEXT_PROFILE_ID = 'profile-223e4567-e89b-42d3-a456-426614174000';

describe('normalizeCommunityMemberRosterPage', () => {
  it('normaliza somente identidade pública canônica e papel comunitário', () => {
    const page = normalizeCommunityMemberRosterPage({
      items: [
        {
          memberKey: PROFILE_ID,
          identity: {
            profileId: PROFILE_ID,
            nickname: 'Perfil Teste',
            label: 'Perfil Teste',
            avatarUrl: 'https://example.com/avatar.webp',
            uid: 'nao-deve-ser-transportado',
          },
          role: 'moderator',
        },
      ],
      nextCursor: NEXT_PROFILE_ID,
      memberCount: 23,
      generatedAt: 123456,
    });

    expect(page).not.toBeNull();
    expect(page?.items).toHaveLength(1);
    expect(page?.items[0].role).toBe('moderator');
    expect(page?.items[0].identity.profileId).toBe(PROFILE_ID);
    expect(page?.items[0].identity.nickname).toBe('Perfil Teste');
    expect((page?.items[0].identity as { uid?: unknown }).uid).toBeUndefined();
  });

  it('descarta itens cujo identificador não coincide com o profileId público', () => {
    const page = normalizeCommunityMemberRosterPage({
      items: [
        {
          memberKey: PROFILE_ID,
          identity: {
            profileId: NEXT_PROFILE_ID,
            nickname: 'Pessoa Inválida',
            label: 'Pessoa Inválida',
          },
          role: 'member',
        },
      ],
      nextCursor: null,
      memberCount: 1,
      generatedAt: 123456,
    });

    expect(page?.items).toHaveLength(0);
  });

  it('falha fechado quando o cursor não é um profileId público canônico', () => {
    expect(
      normalizeCommunityMemberRosterPage({
        items: [],
        nextCursor: 'roster1:dWlkLWludGVybm8',
        memberCount: 0,
        generatedAt: 123456,
      })
    ).toBeNull();
  });
});
