import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canViewerReadCommunityFeedAudience,
  canViewerReadCommunityFeedProjection,
  resolveCommunityFeedContentAccess,
} from './community-feed-access.policy';
import { SanitizedCommunityFeedProjection } from './community-feed.model';

function projection(
  audience: 'public_preview' | 'members_only',
  kind: 'text' | 'photo'
): SanitizedCommunityFeedProjection {
  return {
    audience,
    imageStoragePath: null,
    imageAlt: kind === 'photo' ? 'Foto' : null,
    replyToPostId: null,
    item: {
      postId: 'post-1',
      kind,
      author: { label: 'Equipe', avatarUrl: null },
      text: kind === 'text' ? 'Atualização.' : null,
      image: kind === 'photo'
        ? { url: 'https://example.com/photo.webp', alt: 'Foto' }
        : null,
      replyTo: null,
      metrics: { commentCount: 0, reactionCount: 0 },
      capabilities: {
        canDeleteOwn: false,
        canModerate: false,
        canReport: false,
        canReact: false,
        viewerReacted: false,
        canViewComments: false,
        canComment: false,
      },
      publishedAt: 1_800_000_000_000,
    },
  };
}

test('prévia autenticada concede leitura do conteúdo sem conceder membership', () => {
  const contentAccess = resolveCommunityFeedContentAccess(false, true);

  assert.equal(contentAccess, true);
  assert.equal(
    canViewerReadCommunityFeedProjection(
      projection('members_only', 'text'),
      'feed',
      contentAccess
    ),
    true
  );
});

test('comunidade reservada continua exigindo membership ativo', () => {
  assert.equal(resolveCommunityFeedContentAccess(false, false), false);
  assert.equal(resolveCommunityFeedContentAccess(true, false), true);
});

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

test('visitante sem acesso de conteúdo não lê publicação reservada a membros', () => {
  assert.equal(
    canViewerReadCommunityFeedProjection(
      projection('members_only', 'text'),
      'feed',
      false
    ),
    false
  );
});

test('membro autorizado lê publicação reservada', () => {
  assert.equal(
    canViewerReadCommunityFeedProjection(
      projection('members_only', 'text'),
      'feed',
      true
    ),
    true
  );
});

test('visitante sem acesso de conteúdo não lê foto reservada', () => {
  assert.equal(
    canViewerReadCommunityFeedProjection(
      projection('members_only', 'photo'),
      'feed',
      false
    ),
    false
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

test('cursor reservado também exige autorização de conteúdo', () => {
  const membersOnly = projection('members_only', 'photo');

  assert.equal(canViewerReadCommunityFeedAudience(membersOnly, false), false);
  assert.equal(canViewerReadCommunityFeedAudience(membersOnly, true), true);
});
