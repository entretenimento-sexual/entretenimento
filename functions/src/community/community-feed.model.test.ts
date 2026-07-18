// functions/src/community/community-feed.model.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCommunityFeedPageRequest,
  sanitizeCommunityFeedProjection,
} from './community-feed.model';

const NOW = 1_800_000_000_000;

function feedItem(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'photo',
    audience: 'public_preview',
    status: 'active',
    moderationState: 'active',
    author: {
      label: 'Equipe do local',
      avatarUrl: 'https://example.com/avatar.webp',
    },
    text: 'Movimento tranquilo nesta noite.',
    image: {
      url: 'https://example.com/photo.webp',
      alt: 'Ambiente iluminado do local',
    },
    metrics: {
      commentCount: 3,
      reactionCount: 8,
    },
    publishedAt: NOW - 10_000,
    ...overrides,
  };
}

test('normaliza mural, fotos, limite e cursor', () => {
  assert.deepEqual(
    normalizeCommunityFeedPageRequest({
      communityId: 'community-1',
      view: 'photos',
      limit: 999,
      cursor: 'post-1',
    }),
    {
      communityId: 'community-1',
      view: 'photos',
      limit: 20,
      cursor: 'post-1',
    }
  );
});

test('rejeita communityId e cursor inseguros', () => {
  const request = normalizeCommunityFeedPageRequest({
    communityId: '../community',
    cursor: 'https://example.com',
  });

  assert.equal(request.communityId, null);
  assert.equal(request.cursor, null);
});

test('sanitiza publicação pública com foto', () => {
  const result = sanitizeCommunityFeedProjection('post-1', feedItem(), NOW);

  assert.equal(result?.audience, 'public_preview');
  assert.equal(result?.item.kind, 'photo');
  assert.equal(result?.item.author.label, 'Equipe do local');
  assert.equal(result?.item.metrics.reactionCount, 8);
});

test('mantém item válido quando avatar usa URL insegura', () => {
  const result = sanitizeCommunityFeedProjection(
    'post-1',
    feedItem({
      author: { label: 'Moderação', avatarUrl: 'http://insecure.test/a.jpg' },
    }),
    NOW
  );

  assert.equal(result?.item.author.avatarUrl, null);
});

test('descarta foto sem HTTPS e texto vazio', () => {
  assert.equal(
    sanitizeCommunityFeedProjection(
      'post-1',
      feedItem({ image: { url: 'http://insecure.test/photo.jpg' } }),
      NOW
    ),
    null
  );

  assert.equal(
    sanitizeCommunityFeedProjection(
      'post-2',
      feedItem({ kind: 'text', text: '   ', image: null }),
      NOW
    ),
    null
  );
});

test('descarta conteúdo oculto, expirado ou futuro', () => {
  assert.equal(
    sanitizeCommunityFeedProjection(
      'post-1',
      feedItem({ moderationState: 'pending_review' }),
      NOW
    ),
    null
  );
  assert.equal(
    sanitizeCommunityFeedProjection(
      'post-2',
      feedItem({ expiresAt: NOW - 1 }),
      NOW
    ),
    null
  );
  assert.equal(
    sanitizeCommunityFeedProjection(
      'post-3',
      feedItem({ publishedAt: NOW + 10 * 60_000 }),
      NOW
    ),
    null
  );
});

test('aceita audiência exclusiva para membros sem expor UID', () => {
  const result = sanitizeCommunityFeedProjection(
    'post-members',
    feedItem({ audience: 'members_only' }),
    NOW
  );

  assert.equal(result?.audience, 'members_only');
  assert.equal('uid' in (result?.item.author ?? {}), false);
});
