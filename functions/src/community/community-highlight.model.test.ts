import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCommunityHighlightActive,
  normalizeCommunityHighlightReadRequest,
  normalizeCommunityHighlightRequest,
  normalizeCommunityHighlightSnapshot,
  resolveCommunityHighlightExpiresAt,
} from './community-highlight.model';

test('normaliza fixação e aplica 7 dias como duração padrão', () => {
  assert.deepEqual(normalizeCommunityHighlightRequest({
    requestId: 'request-1',
    communityId: 'community-1',
    action: 'pin',
    targetType: 'feed_post',
    targetId: 'post-1',
  }), {
    requestId: 'request-1',
    communityId: 'community-1',
    action: 'pin',
    targetType: 'feed_post',
    targetId: 'post-1',
    duration: '7d',
  });
});

test('aceita somente durações canônicas e ignora alvo ao desafixar', () => {
  assert.deepEqual(normalizeCommunityHighlightRequest({
    requestId: 'request-2',
    communityId: 'community-1',
    action: 'unpin',
    targetType: 'feed_post',
    targetId: 'post-1',
    duration: '30d',
  }), {
    requestId: 'request-2',
    communityId: 'community-1',
    action: 'unpin',
    targetType: null,
    targetId: null,
    duration: null,
  });

  assert.deepEqual(normalizeCommunityHighlightRequest({
    requestId: 'request-3',
    communityId: 'community-1',
    action: 'pin',
    targetType: 'topic',
    targetId: 'topic-1',
    duration: 'forever',
  }), {
    requestId: 'request-3',
    communityId: 'community-1',
    action: 'pin',
    targetType: null,
    targetId: 'topic-1',
    duration: '7d',
  });
});

test('normaliza leitura e snapshot persistido sem expor metadados administrativos', () => {
  assert.deepEqual(
    normalizeCommunityHighlightReadRequest({ communityId: 'community-1' }),
    { communityId: 'community-1' }
  );

  assert.deepEqual(normalizeCommunityHighlightSnapshot({
    targetType: 'feed_post',
    targetId: 'post-1',
    duration: '7d',
    pinnedAt: 1_000,
    expiresAt: 2_000,
    pinnedBy: 'uid-secret',
    pinnedByRole: 'owner',
  }), {
    targetType: 'feed_post',
    targetId: 'post-1',
    duration: '7d',
    pinnedAt: 1_000,
    expiresAt: 2_000,
  });
});

test('distingue destaque ativo de destaque vencido', () => {
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

  assert.ok(active);
  assert.ok(permanent);
  assert.equal(isCommunityHighlightActive(active, 1_999), true);
  assert.equal(isCommunityHighlightActive(active, 2_000), false);
  assert.equal(isCommunityHighlightActive(permanent, 999_999), true);
});

test('calcula vencimento separado da vida da publicação', () => {
  const now = 1_000_000;

  assert.equal(
    resolveCommunityHighlightExpiresAt('24h', now),
    now + 24 * 60 * 60_000
  );
  assert.equal(
    resolveCommunityHighlightExpiresAt('3d', now),
    now + 3 * 24 * 60 * 60_000
  );
  assert.equal(
    resolveCommunityHighlightExpiresAt('7d', now),
    now + 7 * 24 * 60 * 60_000
  );
  assert.equal(
    resolveCommunityHighlightExpiresAt('30d', now),
    now + 30 * 24 * 60 * 60_000
  );
  assert.equal(
    resolveCommunityHighlightExpiresAt('until_unpinned', now),
    null
  );
});
