import { describe, expect, it } from 'vitest';

import { buildCommunityFeedPostCreatePayload } from './community-feed.repository';

describe('buildCommunityFeedPostCreatePayload', () => {
  it('preserva localização precisa e acurácia ao montar o payload da callable', () => {
    const payload = buildCommunityFeedPostCreatePayload({
      requestId: ' request-1 ',
      communityId: ' community-1 ',
      text: '  ',
      audience: 'members_only',
      imageUploadPath: null,
      location: {
        latitude: -22.912345,
        longitude: -43.176543,
        precision: 'precise',
        accuracyMeters: 8,
      },
      replyToPostId: null,
    });

    expect(payload).toEqual({
      requestId: 'request-1',
      communityId: 'community-1',
      text: '',
      audience: 'members_only',
      imageUploadPath: null,
      location: {
        latitude: -22.912345,
        longitude: -43.176543,
        precision: 'precise',
        accuracyMeters: 8,
      },
      replyToPostId: null,
    });
  });

  it('mantém localização ausente como null sem alterar o fluxo de texto', () => {
    const payload = buildCommunityFeedPostCreatePayload({
      requestId: 'request-2',
      communityId: 'community-1',
      text: '  Mensagem  ',
      audience: 'members_only',
      imageUploadPath: null,
      location: null,
      replyToPostId: ' post-1 ',
    });

    expect(payload.location).toBeNull();
    expect(payload.text).toBe('Mensagem');
    expect(payload.replyToPostId).toBe('post-1');
  });
});
