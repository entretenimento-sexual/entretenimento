import { describe, expect, it } from 'vitest';

import {
  isCommunityHighlightActive,
  normalizeCommunityHighlightReadRequest,
  normalizeCommunityHighlightRequest,
  normalizeCommunityHighlightSnapshot,
  resolveCommunityHighlightExpiresAt,
} from './community-highlight.model';

describe('community-highlight.model', () => {
  it('normaliza fixação e aplica 7 dias como duração padrão', () => {
    expect(normalizeCommunityHighlightRequest({
      requestId: 'request-1',
      communityId: 'community-1',
      action: 'pin',
      targetType: 'feed_post',
      targetId: 'post-1',
    })).toEqual({
      requestId: 'request-1',
      communityId: 'community-1',
      action: 'pin',
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: '7d',
    });
  });

  it('aceita somente durações canônicas e ignora alvo ao desafixar', () => {
    expect(normalizeCommunityHighlightRequest({
      requestId: 'request-2',
      communityId: 'community-1',
      action: 'unpin',
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: '30d',
    })).toEqual({
      requestId: 'request-2',
      communityId: 'community-1',
      action: 'unpin',
      targetType: null,
      targetId: null,
      duration: null,
    });

    expect(normalizeCommunityHighlightRequest({
      requestId: 'request-3',
      communityId: 'community-1',
      action: 'pin',
      targetType: 'topic',
      targetId: 'topic-1',
      duration: 'forever',
    })).toEqual({
      requestId: 'request-3',
      communityId: 'community-1',
      action: 'pin',
      targetType: null,
      targetId: 'topic-1',
      duration: '7d',
    });
  });

  it('normaliza leitura e snapshot persistido sem expor metadados administrativos', () => {
    expect(normalizeCommunityHighlightReadRequest({ communityId: 'community-1' }))
      .toEqual({ communityId: 'community-1' });

    expect(normalizeCommunityHighlightSnapshot({
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: '7d',
      pinnedAt: 1_000,
      expiresAt: 2_000,
      pinnedBy: 'uid-secret',
      pinnedByRole: 'owner',
    })).toEqual({
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: '7d',
      pinnedAt: 1_000,
      expiresAt: 2_000,
    });
  });

  it('distingue destaque ativo de destaque vencido', () => {
    const active = normalizeCommunityHighlightSnapshot({
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: '24h',
      pinnedAt: 1_000,
      expiresAt: 2_000,
    });
    const permanent = normalizeCommunityHighlightSnapshot({
      targetType: 'feed_post',
      targetId: 'post-2',
      duration: 'until_unpinned',
      pinnedAt: 1_000,
      expiresAt: null,
    });

    expect(active).not.toBeNull();
    expect(permanent).not.toBeNull();
    expect(isCommunityHighlightActive(active!, 1_999)).toBe(true);
    expect(isCommunityHighlightActive(active!, 2_000)).toBe(false);
    expect(isCommunityHighlightActive(permanent!, 999_999)).toBe(true);
  });

  it('calcula vencimento separado da vida da publicação', () => {
    const now = 1_000_000;

    expect(resolveCommunityHighlightExpiresAt('24h', now))
      .toBe(now + 24 * 60 * 60_000);
    expect(resolveCommunityHighlightExpiresAt('3d', now))
      .toBe(now + 3 * 24 * 60 * 60_000);
    expect(resolveCommunityHighlightExpiresAt('7d', now))
      .toBe(now + 7 * 24 * 60 * 60_000);
    expect(resolveCommunityHighlightExpiresAt('30d', now))
      .toBe(now + 30 * 24 * 60 * 60_000);
    expect(resolveCommunityHighlightExpiresAt('until_unpinned', now)).toBeNull();
  });
});
