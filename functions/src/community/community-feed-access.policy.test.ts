import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canViewerReadCommunityFeedAudience,
  canViewerReadCommunityFeedProjection,
} from './community-feed-access.policy';
import { SanitizedCommunityFeedProjection } from './community-feed.model';

function projection(
  audience: 'public_preview' | 'members_only',
  kind: 'text' | 'photo'
): SanitizedCommunityFeedProjection {
  return {
    audience,
    item: {
      postId: 'post-1',
      kind,
      author: { label: 'Equipe', avatarUrl: null },
      text: kind === 'text' ? 'Atualização.' : null,
      image: kind === 'photo'
        ? { url: 'https://example.com/photo.webp', alt: 'Foto' }
        : null,
      metrics: { commentCount: 0, reactionCount: 0 },
      publishedAt: 1_800_000_000_000,
    },
  };
}

test('visitante lê publicação pública', () => {
  assert.equal(
    canViewerReadCommunityFeedProjection(
      projection('public_preview', 'text'),
      'feed',
      false
    ),
    true
  );
});

test('visitante não lê publicação reservada a membros', () => {
  assert.equal(
    canViewerReadCommunityFeedProjection(
      projection('members_only', 'text'),
      'feed',
      false
    ),
    false
  );
});

test('membro ativo lê publicação reservada', () => {
  assert.equal(
    canViewerReadCommunityFeedProjection(
      projection('members_only', 'text'),
      'feed',
      true
    ),
    true
  );
});

test('galeria aceita somente publicações com foto', () => {
  assert.equal(
    canViewerReadCommunityFeedProjection(
      projection('public_preview', 'text'),
      'photos',
      true
    ),
    false
  );
  assert.equal(
    canViewerReadCommunityFeedProjection(
      projection('public_preview', 'photo'),
      'photos',
      false
    ),
    true
  );
});

test('cursor reservado também exige membership ativa', () => {
  const membersOnly = projection('members_only', 'photo');

  assert.equal(canViewerReadCommunityFeedAudience(membersOnly, false), false);
  assert.equal(canViewerReadCommunityFeedAudience(membersOnly, true), true);
});
