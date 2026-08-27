import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCommunityFeedRealtimeProjection } from './community-feed-realtime.projection';

const NOW = Date.UTC(2026, 7, 23, 12, 0, 0);

function activePhoto() {
  return {
    kind: 'photo',
    audience: 'public_preview',
    status: 'active',
    moderationState: 'active',
    author: {
      label: 'Pessoa teste',
      avatarUrl: 'https://example.com/avatar.webp',
    },
    text: 'Texto que não deve ir para a projeção realtime.',
    image: {
      storagePath: 'users/u1/published/images/post-1/photo.webp',
      alt: 'Foto privada por URL temporária',
    },
    metrics: { commentCount: 4, reactionCount: 7 },
    publishedAt: NOW - 1_000,
  };
}

test('projeta somente metadados mínimos necessários para sincronização realtime', () => {
  const projection = buildCommunityFeedRealtimeProjection(
    'post-1',
    null,
    activePhoto(),
    NOW
  );

  assert.deepEqual(projection, {
    postId: 'post-1',
    kind: 'photo',
    state: 'active',
    metrics: { commentCount: 4, reactionCount: 7 },
    publishedAt: NOW - 1_000,
    eventAt: NOW,
  });

  const serialized = JSON.stringify(projection);
  for (const forbidden of ['storagePath', 'actorUid', 'audience', 'author', 'text', 'image']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('publica tombstone mínimo quando item antes legível deixa de estar ativo', () => {
  const after = {
    ...activePhoto(),
    moderationState: 'removed',
  };
  const projection = buildCommunityFeedRealtimeProjection(
    'post-1',
    activePhoto(),
    after,
    NOW
  );

  assert.equal(projection?.state, 'removed');
  assert.equal(projection?.postId, 'post-1');
  assert.equal(projection?.kind, 'photo');
});

test('ignora transição sem projeção válida antes ou depois', () => {
  assert.equal(
    buildCommunityFeedRealtimeProjection('post-1', null, { status: 'removed' }, NOW),
    null
  );
});
