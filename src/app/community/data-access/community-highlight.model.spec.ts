import { describe, expect, it } from 'vitest';

import {
  isCommunityHighlightActive,
  normalizeCommunityHighlightManageResponse,
  normalizeCommunityHighlightReadResponse,
  normalizeCommunityHighlightSnapshot,
} from './community-highlight.model';

describe('Community highlight client contracts', () => {
  it('normaliza destaque temporário válido', () => {
    expect(normalizeCommunityHighlightSnapshot({
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: '7d',
      pinnedAt: 1_000,
      expiresAt: 2_000,
      pinnedBy: 'uid-private',
    })).toEqual({
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: '7d',
      pinnedAt: 1_000,
      expiresAt: 2_000,
    });
  });

  it('rejeita combinações inconsistentes de duração e expiração', () => {
    expect(normalizeCommunityHighlightSnapshot({
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: '7d',
      pinnedAt: 1_000,
      expiresAt: null,
    })).toBeNull();

    expect(normalizeCommunityHighlightSnapshot({
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: 'until_unpinned',
      pinnedAt: 1_000,
      expiresAt: 2_000,
    })).toBeNull();
  });

  it('normaliza leitura sem destaque e preserva capacidade de gestão', () => {
    expect(normalizeCommunityHighlightReadResponse({
      communityId: 'community-1',
      highlight: null,
      canManage: true,
      generatedAt: 5_000,
    })).toEqual({
      communityId: 'community-1',
      highlight: null,
      canManage: true,
      generatedAt: 5_000,
    });
  });

  it('falha fechado diante de resposta de leitura malformada', () => {
    expect(() => normalizeCommunityHighlightReadResponse({
      communityId: '../unsafe',
      highlight: null,
      canManage: true,
      generatedAt: 5_000,
    })).toThrowError('Resposta de destaque da Comunidade inválida.');
  });

  it('exige destaque no retorno de fixação e ausência no retorno de desafixar', () => {
    expect(() => normalizeCommunityHighlightManageResponse({
      communityId: 'community-1',
      action: 'pin',
      highlight: null,
      changed: true,
      deduplicated: false,
      generatedAt: 5_000,
    })).toThrowError('Resposta de gestão do destaque da Comunidade inválida.');

    expect(() => normalizeCommunityHighlightManageResponse({
      communityId: 'community-1',
      action: 'unpin',
      highlight: {
        targetType: 'feed_post',
        targetId: 'post-1',
        duration: '7d',
        pinnedAt: 1_000,
        expiresAt: 2_000,
      },
      changed: true,
      deduplicated: false,
      generatedAt: 5_000,
    })).toThrowError('Resposta de gestão do destaque da Comunidade inválida.');
  });

  it('distingue destaque ativo de vencido sem tocar a publicação original', () => {
    const highlight = normalizeCommunityHighlightSnapshot({
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: '24h',
      pinnedAt: 1_000,
      expiresAt: 2_000,
    });

    expect(highlight).not.toBeNull();
    expect(isCommunityHighlightActive(highlight!, 1_999)).toBe(true);
    expect(isCommunityHighlightActive(highlight!, 2_000)).toBe(false);
  });
});
