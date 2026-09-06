// functions/src/community/community-discovery-diversity.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  diversifyCommunityDiscoveryPage,
} from './community-discovery-diversity.policy';
import type { CommunityPreviewCard } from './community-preview.model';

function communityCard(
  id: string,
  tagId: string | null = null
): CommunityPreviewCard {
  return {
    communityId: id,
    name: id,
    slug: id,
    description: null,
    source: {
      type: 'community',
      id,
    },
    avatarUrl: null,
    coverUrl: null,
    metrics: {
      memberCount: 0,
      postCount: 0,
      mediaCount: 0,
    },
    access: {
      join: 'open',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: tagId
      ? [{ id: tagId, label: tagId, category: 'intent' }]
      : [],
  };
}

function ids(items: readonly CommunityPreviewCard[]): string[] {
  return items.map((item) => item.communityId);
}

test('mantém a ordem canônica quando a página já é diversa', () => {
  const input = [
    communityCard('a1', 'intent:a'),
    communityCard('b1', 'intent:b'),
    communityCard('a2', 'intent:a'),
    communityCard('c1', 'intent:c'),
  ];

  assert.deepEqual(ids(diversifyCommunityDiscoveryPage(input)), ids(input));
});

test('quebra terceira ocorrência consecutiva quando há alternativa próxima', () => {
  const input = [
    communityCard('a1', 'intent:a'),
    communityCard('a2', 'intent:a'),
    communityCard('a3', 'intent:a'),
    communityCard('b1', 'intent:b'),
    communityCard('c1', 'intent:c'),
  ];

  assert.deepEqual(
    ids(diversifyCommunityDiscoveryPage(input)),
    ['a1', 'a2', 'b1', 'a3', 'c1']
  );
});

test('não inventa diversidade quando não existe alternativa no lookahead', () => {
  const input = [
    communityCard('a1', 'intent:a'),
    communityCard('a2', 'intent:a'),
    communityCard('a3', 'intent:a'),
    communityCard('a4', 'intent:a'),
    communityCard('a5', 'intent:a'),
    communityCard('a6', 'intent:a'),
    communityCard('a7', 'intent:a'),
    communityCard('b1', 'intent:b'),
  ];

  const result = diversifyCommunityDiscoveryPage(input);
  assert.deepEqual(ids(result).slice(0, 3), ['a1', 'a2', 'a3']);
});

test('é determinística e preserva todos os cards exatamente uma vez', () => {
  const input = [
    communityCard('a1', 'intent:a'),
    communityCard('a2', 'intent:a'),
    communityCard('a3', 'intent:a'),
    communityCard('b1', 'intent:b'),
    communityCard('b2', 'intent:b'),
    communityCard('c1', null),
  ];

  const first = diversifyCommunityDiscoveryPage(input);
  const second = diversifyCommunityDiscoveryPage(input);

  assert.deepEqual(ids(first), ids(second));
  assert.deepEqual([...ids(first)].sort(), [...ids(input)].sort());
  assert.equal(new Set(ids(first)).size, input.length);
  assert.deepEqual(ids(input), ['a1', 'a2', 'a3', 'b1', 'b2', 'c1']);
});
