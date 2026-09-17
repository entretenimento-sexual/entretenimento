import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityFeedRateWindow,
  evaluateCommunityFeedWrite,
  resolveCommunityFeedAudience,
  resolveCommunityFeedWriteLimit,
} from './community-feed-write.policy';
import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';

const NOW = 1_800_000_000_000;
const FEED_POST_QUOTA = COMMUNITY_PRODUCT_LIMITS.contentWriteQuotas.feedPosts;

test('membro ativo publica no Mural sem escolher audiência por mensagem', () => {
  assert.deepEqual(
    evaluateCommunityFeedWrite({
      sourceType: 'community',
      memberActivityAllowed: true,
      membershipStatus: 'active',
      viewerRole: 'member',
    }),
    { allowed: true, denialReason: null }
  );

  for (const viewerRole of ['owner', 'admin', 'moderator'] as const) {
    assert.equal(
      evaluateCommunityFeedWrite({
        sourceType: 'community',
        memberActivityAllowed: true,
        membershipStatus: 'active',
        viewerRole,
      }).allowed,
      true
    );
  }
});

test('audiência segue a visibilidade da Comunidade e falha fechada', () => {
  assert.equal(resolveCommunityFeedAudience('public_preview'), 'public_preview');
  assert.equal(resolveCommunityFeedAudience('members_only'), 'members_only');
  assert.equal(resolveCommunityFeedAudience(null), 'members_only');
  assert.equal(resolveCommunityFeedAudience('unexpected'), 'members_only');
});

test('nega Local, lifecycle fechado e vínculo não ativo', () => {
  const base = {
    sourceType: 'community',
    memberActivityAllowed: true,
    membershipStatus: 'active',
    viewerRole: 'member' as const,
  };

  assert.equal(
    evaluateCommunityFeedWrite({ ...base, sourceType: 'venue' }).denialReason,
    'community_unavailable'
  );
  assert.equal(
    evaluateCommunityFeedWrite({
      ...base,
      memberActivityAllowed: false,
    }).denialReason,
    'community_unavailable'
  );
  assert.equal(
    evaluateCommunityFeedWrite({
      ...base,
      membershipStatus: 'pending',
    }).denialReason,
    'active_membership_required'
  );
});

test('quota funcional usa configuração canônica e reinicia após a janela', () => {
  assert.equal(
    resolveCommunityFeedWriteLimit(null),
    FEED_POST_QUOTA.defaultLimit
  );
  assert.equal(
    resolveCommunityFeedWriteLimit({ maxFeedPostsPer24h: 999 }),
    FEED_POST_QUOTA.maxLimit
  );

  assert.deepEqual(
    evaluateCommunityFeedRateWindow(null, NOW, 2),
    { allowed: true, windowStartedAt: NOW, nextCount: 1 }
  );
  assert.equal(
    evaluateCommunityFeedRateWindow({
      windowStartedAt: NOW - 1_000,
      writesInWindow: 2,
    }, NOW, 2).allowed,
    false
  );
  assert.deepEqual(
    evaluateCommunityFeedRateWindow({
      windowStartedAt: NOW - FEED_POST_QUOTA.windowMs,
      writesInWindow: 2,
    }, NOW, 2),
    { allowed: true, windowStartedAt: NOW, nextCount: 1 }
  );
});
