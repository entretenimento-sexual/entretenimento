import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityFeedCommentActionResponse,
  normalizeCommunityFeedCommentCreateResponse,
  normalizeCommunityFeedCommentPageResponse,
} from './community-feed-comment.model';

const CREATED_AT = Date.now() - 60_000;

function comment(overrides: Record<string, unknown> = {}) {
  return {
    commentId: 'comment-1',
    actorUid: 'private-user-id',
    author: {
      label: 'Pessoa participante',
      avatarUrl: 'https://example.com/avatar.webp',
    },
    text: 'Uma contribuição para a conversa.',
    capabilities: {
      canDeleteOwn: true,
      canModerate: false,
      canReport: false,
    },
    createdAt: CREATED_AT,
    ...overrides,
  };
}

describe('normalizeCommunityFeedCommentPageResponse', () => {
  it('sanitiza mensagens sem expor identificadores internos', () => {
    const page = normalizeCommunityFeedCommentPageResponse({
      items: [comment()],
      nextCursor: 'comment-1',
      generatedAt: CREATED_AT + 1,
    });

    expect(page.items).toEqual([
      {
        commentId: 'comment-1',
        author: {
          profileId: null,
          nickname: 'Pessoa participante',
          label: 'Pessoa participante',
          avatarUrl: 'https://example.com/avatar.webp',
          identityCode: null,
          identityLabel: null,
          identityShortLabel: null,
          discoveryGroup: null,
          city: null,
          state: null,
          profileType: null,
          profileTypeLabel: null,
        },
        text: 'Uma contribuição para a conversa.',
        replyTo: null,
        capabilities: {
          canDeleteOwn: true,
          canModerate: false,
          canReport: false,
        },
        createdAt: CREATED_AT,
      },
    ]);
    expect('actorUid' in page.items[0]).toBe(false);
    expect(page.nextCursor).toBe('comment-1');
  });

  it('normaliza citação sanitizada sem aceitar identificador inseguro', () => {
    const page = normalizeCommunityFeedCommentPageResponse({
      items: [
        comment({
          commentId: 'comment-2',
          replyTo: {
            commentId: 'comment-1',
            authorLabel: 'Pessoa original',
            textPreview: 'Mensagem original para contexto.',
            available: true,
          },
        }),
        comment({
          commentId: 'comment-3',
          replyTo: {
            commentId: '../unsafe',
            authorLabel: 'Não usar',
            textPreview: 'Não usar',
          },
        }),
      ],
    });

    expect(page.items[0].replyTo).toEqual({
      commentId: 'comment-1',
      authorLabel: 'Pessoa original',
      textPreview: 'Mensagem original para contexto.',
      available: true,
    });
    expect(page.items[1].replyTo).toBeNull();
  });

  it('normaliza tipo de perfil e localização pública coarse', () => {
    const page = normalizeCommunityFeedCommentPageResponse({
      items: [comment({
        author: {
          label: 'casal_serale',
          avatarUrl: 'https://example.com/casal.webp',
          profileType: 'couple',
          profileTypeLabel: 'valor não confiável do transporte',
          city: 'Rio de Janeiro',
          state: 'RJ',
          uid: 'não deve sair no modelo público',
        },
      })],
    });

    expect(page.items[0].author).toEqual({
      profileId: null,
      nickname: 'casal_serale',
      label: 'casal_serale',
      avatarUrl: 'https://example.com/casal.webp',
      identityCode: null,
      identityLabel: 'Casal',
      identityShortLabel: 'Casal',
      discoveryGroup: 'couple',
      city: 'Rio de Janeiro',
      state: 'RJ',
      profileType: 'couple',
      profileTypeLabel: 'Casal',
    });
    expect('uid' in page.items[0].author).toBe(false);
  });

  it('descarta payload inseguro e avatar sem HTTPS', () => {
    const page = normalizeCommunityFeedCommentPageResponse({
      items: [
        comment({
          author: { label: 'Pessoa', avatarUrl: 'http://example.com/a.jpg' },
        }),
        comment({ commentId: '../invalid' }),
        comment({ commentId: 'comment-3', text: '   ' }),
      ],
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0].author.avatarUrl).toBeNull();
  });
});

describe('community feed comment write responses', () => {
  it('normaliza criação e contador autoritativo da conversa', () => {
    expect(normalizeCommunityFeedCommentCreateResponse({
      communityId: 'community-1',
      postId: 'post-1',
      commentId: 'comment-1',
      commentCount: 9,
      created: true,
      deduplicated: false,
    }).commentCount).toBe(9);
  });

  it('normaliza remoção e rejeita referências inválidas', () => {
    expect(normalizeCommunityFeedCommentActionResponse({
      communityId: 'community-1',
      postId: 'post-1',
      commentId: 'comment-1',
      action: 'remove',
      status: 'removed',
      commentCount: 8,
      deduplicated: false,
      generatedAt: CREATED_AT,
    }).status).toBe('removed');

    expect(() => normalizeCommunityFeedCommentCreateResponse({
      communityId: '../unsafe',
      postId: 'post-1',
      commentId: 'comment-1',
    })).toThrow('Resposta de comentário no Mural inválida.');
  });
});
