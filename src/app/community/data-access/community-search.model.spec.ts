import { describe, expect, it } from 'vitest';

import { normalizeCommunitySearchPage } from './community-search.model';

describe('community search model', () => {
  it('normaliza membro sem aceitar identidade inconsistente', () => {
    const page = normalizeCommunitySearchPage({
      scope: 'members',
      query: 'alex',
      available: true,
      generatedAt: Date.now(),
      nextCursor: 'm1_cursor',
      items: [
        {
          type: 'member',
          memberKey: 'perfil-publico',
          identity: {
            profileId: 'perfil-publico',
            nickname: 'Alex',
            label: 'Alex',
            avatarUrl: null,
          },
          role: 'member',
        },
        {
          type: 'member',
          memberKey: 'outro',
          identity: {
            profileId: 'divergente',
            nickname: 'Outro',
            label: 'Outro',
            avatarUrl: null,
          },
          role: 'member',
        },
      ],
    });

    expect(page?.items).toHaveLength(1);
    expect(page?.items[0]?.type).toBe('member');
  });

  it('reutiliza a normalização canônica de Tópicos', () => {
    const now = Date.now();
    const page = normalizeCommunitySearchPage({
      scope: 'topics',
      query: 'foto',
      available: true,
      generatedAt: now,
      nextCursor: null,
      items: [
        {
          type: 'topic',
          topicId: 'topic-1',
          title: 'Fotografia',
          excerpt: 'Discussão sobre fotografia.',
          author: { label: 'Participante', avatarUrl: null },
          status: 'active',
          metrics: { replyCount: 2, reactionCount: 0 },
          createdAt: now - 1000,
          lastActivityAt: now,
        },
      ],
    });

    expect(page?.items).toHaveLength(1);
    expect(page?.items[0]?.type).toBe('topic');
  });
});
