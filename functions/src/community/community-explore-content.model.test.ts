import { describe, expect, it } from 'vitest';

import {
  buildCommunityExploreContentProjection,
  communityExploreContentSourceFingerprint,
} from './community-explore-content.model';

const discovery = {
  status: 'active',
  moderationState: 'active',
  visibility: 'public_preview',
  name: 'Cinema independente',
  slug: 'cinema-independente',
  source: { type: 'community', id: 'community-1' },
  access: { join: 'open' },
  metrics: { memberCount: 10, postCount: 2, mediaCount: 0 },
  tagIds: [],
};

const feed = {
  kind: 'text',
  audience: 'public_preview',
  status: 'active',
  moderationState: 'active',
  author: { label: 'Pessoa autora', avatarUrl: null },
  text: 'Uma publicação pública',
  image: null,
  location: null,
  replyToPostId: null,
  metrics: { commentCount: 0, reactionCount: 0 },
  publishedAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
};

describe('community explore content projection', () => {
  it('aceita somente publicação pública de Comunidade pública', () => {
    const projection = buildCommunityExploreContentProjection({
      communityId: 'community-1',
      postId: 'post-1',
      discovery,
      feed,
      operationalPost: {
        actorUid: 'author-1',
        status: 'active',
        moderationState: 'active',
      },
      now: 1_800_000_000_100,
    });

    expect(projection?.communityId).toBe('community-1');
    expect(projection?.post.kind).toBe('text');
  });

  it.each([
    ['members_only', { ...feed, audience: 'members_only' }],
    ['reply', { ...feed, replyToPostId: 'parent-1' }],
    ['location', {
      ...feed,
      kind: 'location',
      location: {
        latitude: -22.9,
        longitude: -43.2,
        precision: 'approximate',
        accuracyMeters: null,
      },
    }],
  ])('rejeita %s fora da distribuição global', (_name, rawFeed) => {
    expect(buildCommunityExploreContentProjection({
      communityId: 'community-1',
      postId: 'post-1',
      discovery,
      feed: rawFeed,
      operationalPost: {
        actorUid: 'author-1',
        status: 'active',
        moderationState: 'active',
      },
      now: 1_800_000_000_100,
    })).toBeNull();
  });

  it('rejeita Comunidade que saiu da descoberta pública', () => {
    expect(buildCommunityExploreContentProjection({
      communityId: 'community-1',
      postId: 'post-1',
      discovery: { ...discovery, visibility: 'members_only' },
      feed,
      operationalPost: {
        actorUid: 'author-1',
        status: 'active',
        moderationState: 'active',
      },
      now: 1_800_000_000_100,
    })).toBeNull();
  });

  it('não ressincroniza por alteração isolada de métricas', () => {
    expect(communityExploreContentSourceFingerprint(feed)).toBe(
      communityExploreContentSourceFingerprint({
        ...feed,
        metrics: { commentCount: 99, reactionCount: 120 },
      })
    );
  });
});
