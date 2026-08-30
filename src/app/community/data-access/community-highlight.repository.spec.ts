import { describe, expect, it } from 'vitest';

import { buildCommunityHighlightManagePayload } from './community-highlight.repository';

describe('CommunityHighlightRepository payload', () => {
  it('normaliza fixação e aplica padrões do cliente', () => {
    expect(buildCommunityHighlightManagePayload({
      requestId: ' request-1 ',
      communityId: ' community-1 ',
      action: 'pin',
      targetId: ' post-1 ',
    })).toEqual({
      requestId: 'request-1',
      communityId: 'community-1',
      action: 'pin',
      targetType: 'feed_post',
      targetId: 'post-1',
      duration: '7d',
    });
  });

  it('remove alvo e duração do transporte ao desafixar', () => {
    expect(buildCommunityHighlightManagePayload({
      requestId: ' request-2 ',
      communityId: ' community-1 ',
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
  });
});
