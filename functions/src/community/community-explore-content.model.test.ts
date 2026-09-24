import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityExploreContentProjection,
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

test('aceita somente publicação pública de Comunidade pública', () => {
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

  assert.equal(projection?.communityId, 'community-1');
  assert.equal(projection?.post.kind, 'text');
  });

for (const [name, rawFeed] of [
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
] as const) {
test(`rejeita ${name} fora da distribuição global`, () => {
    assert.equal(buildCommunityExploreContentProjection({
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
    }), null);
  });
}

test('rejeita Comunidade que saiu da descoberta pública', () => {
  assert.equal(buildCommunityExploreContentProjection({
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
  }), null);
  });
