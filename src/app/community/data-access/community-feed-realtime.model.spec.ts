import { describe, expect, it } from 'vitest';

import {
  diffCommunityFeedRealtimeProjections,
  normalizeCommunityFeedRealtimeProjection,
} from './community-feed-realtime.model';

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);

function projectionRaw(overrides: Record<string, unknown> = {}) {
  return {
    postId: 'post-1',
    kind: 'photo',
    state: 'active',
    metrics: { commentCount: 2, reactionCount: 3 },
    publishedAt: NOW - 10_000,
    eventAt: NOW - 1_000,
    ...overrides,
  };
}

describe('community-feed-realtime.model', () => {
  it('normaliza somente o contrato mínimo esperado', () => {
    expect(
      normalizeCommunityFeedRealtimeProjection('post-1', projectionRaw(), NOW)
    ).toEqual({
      postId: 'post-1',
      kind: 'photo',
      state: 'active',
      metrics: { commentCount: 2, reactionCount: 3 },
      publishedAt: NOW - 10_000,
      eventAt: NOW - 1_000,
    });
  });

  it('aceita localização no contrato mínimo realtime', () => {
    expect(
      normalizeCommunityFeedRealtimeProjection(
        'post-1',
        projectionRaw({ kind: 'location' }),
        NOW
      )?.kind
    ).toBe('location');
  });

  it('rejeita documento cujo postId declarado não corresponde ao id do documento', () => {
    expect(
      normalizeCommunityFeedRealtimeProjection(
        'post-1',
        projectionRaw({ postId: 'post-2' }),
        NOW
      )
    ).toBeNull();
  });

  it('calcula added e modified sem confundir saída da janela limitada com remoção', () => {
    const first = normalizeCommunityFeedRealtimeProjection(
      'post-1',
      projectionRaw(),
      NOW
    )!;
    const changed = normalizeCommunityFeedRealtimeProjection(
      'post-1',
      projectionRaw({
        metrics: { commentCount: 4, reactionCount: 3 },
        eventAt: NOW,
      }),
      NOW
    )!;
    const second = normalizeCommunityFeedRealtimeProjection(
      'post-2',
      {
        ...projectionRaw(),
        postId: 'post-2',
        kind: 'text',
        eventAt: NOW,
      },
      NOW
    )!;

    expect(diffCommunityFeedRealtimeProjections([], [first])).toEqual([
      { type: 'added', projection: first },
    ]);
    expect(diffCommunityFeedRealtimeProjections([first], [changed, second])).toEqual([
      { type: 'modified', projection: changed },
      { type: 'added', projection: second },
    ]);
    expect(diffCommunityFeedRealtimeProjections([changed, second], [second])).toEqual([]);
  });

  it('tombstone chega como modified e representa a remoção real', () => {
    const active = normalizeCommunityFeedRealtimeProjection(
      'post-1',
      projectionRaw(),
      NOW
    )!;
    const removed = normalizeCommunityFeedRealtimeProjection(
      'post-1',
      projectionRaw({ state: 'removed', eventAt: NOW }),
      NOW
    )!;

    expect(diffCommunityFeedRealtimeProjections([active], [removed])).toEqual([
      { type: 'modified', projection: removed },
    ]);
  });
});
