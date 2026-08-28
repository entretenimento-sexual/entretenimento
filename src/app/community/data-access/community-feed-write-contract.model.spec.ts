import { describe, expect, it } from 'vitest';

import {
  buildCommunityFeedPostCreateWireRequest,
} from './community-feed-write-contract.model';

describe('buildCommunityFeedPostCreateWireRequest', () => {
  it('envia foto pelo contrato discriminado de attachment', () => {
    const payload = buildCommunityFeedPostCreateWireRequest({
      requestId: ' request-1 ',
      communityId: ' community-1 ',
      text: ' Olá Comunidade ',
      audience: 'members_only',
      imageUploadPath: ' users/u1/uploads/images/photo.webp ',
      replyToPostId: ' post-original ',
    });

    expect(payload).toEqual({
      requestId: 'request-1',
      communityId: 'community-1',
      text: 'Olá Comunidade',
      audience: 'members_only',
      attachment: {
        type: 'photo',
        uploadPath: 'users/u1/uploads/images/photo.webp',
      },
      replyToPostId: 'post-original',
    });
    expect('imageUploadPath' in payload).toBe(false);
  });

  it('envia attachment nulo quando a publicação não possui foto', () => {
    expect(buildCommunityFeedPostCreateWireRequest({
      requestId: 'request-2',
      communityId: 'community-1',
      text: 'Mensagem textual',
      audience: 'members_only',
      imageUploadPath: null,
    }).attachment).toBeNull();
  });
});
