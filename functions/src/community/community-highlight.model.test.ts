import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityHighlightRequest,
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
