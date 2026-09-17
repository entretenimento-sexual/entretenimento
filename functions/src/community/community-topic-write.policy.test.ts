import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';
import {
  evaluateCommunityTopicRateWindow,
  resolveCommunityTopicAudience,
  resolveCommunityTopicWriteLimit,
} from './community-topic-write.policy';

const TOPIC_CREATION_QUOTA =
  COMMUNITY_PRODUCT_LIMITS.contentWriteQuotas.topicCreations;
const TOPIC_REPLY_QUOTA = COMMUNITY_PRODUCT_LIMITS.contentWriteQuotas.topicReplies;

test('audiência segue a visibilidade da Comunidade e falha fechada', () => {
  assert.equal(resolveCommunityTopicAudience('public_preview'), 'public_preview');
  assert.equal(resolveCommunityTopicAudience('members_only'), 'members_only');
  assert.equal(resolveCommunityTopicAudience(null), 'members_only');
  assert.equal(resolveCommunityTopicAudience('unexpected'), 'members_only');
});

test('usa quotas canônicas e aceita configuração controlada', () => {
  assert.equal(
    resolveCommunityTopicWriteLimit({}, 'topic'),
    TOPIC_CREATION_QUOTA.defaultLimit
  );
  assert.equal(
    resolveCommunityTopicWriteLimit({}, 'reply'),
    TOPIC_REPLY_QUOTA.defaultLimit
  );
  assert.equal(
    resolveCommunityTopicWriteLimit({ maxTopicCreationsPer24h: 20 }, 'topic'),
    20
  );
  assert.equal(
    resolveCommunityTopicWriteLimit({ maxTopicRepliesPer24h: 250 }, 'reply'),
    250
  );
  assert.equal(
    resolveCommunityTopicWriteLimit({ maxTopicCreationsPer24h: 999 }, 'topic'),
    TOPIC_CREATION_QUOTA.maxLimit
  );
  assert.equal(
    resolveCommunityTopicWriteLimit({ maxTopicRepliesPer24h: 9_999 }, 'reply'),
    TOPIC_REPLY_QUOTA.maxLimit
  );
});

test('incrementa dentro da janela e bloqueia ao atingir o teto', () => {
  const now = 2_000_000;
  const state = {
    topicWindowStartedAt: now - 1_000,
    topicWritesInWindow: 2,
  };

  assert.deepEqual(evaluateCommunityTopicRateWindow(state, 'topic', now, 3), {
    allowed: true,
    windowStartedAt: now - 1_000,
    nextCount: 3,
  });
  assert.deepEqual(
    evaluateCommunityTopicRateWindow(
      { ...state, topicWritesInWindow: 3 },
      'topic',
      now,
      3
    ),
    {
      allowed: false,
      windowStartedAt: now - 1_000,
      nextCount: 3,
    }
  );
});

test('reinicia janela expirada sem carregar contador antigo', () => {
  const now = 100_000_000;
  const decision = evaluateCommunityTopicRateWindow(
    {
      replyWindowStartedAt: now - TOPIC_REPLY_QUOTA.windowMs - 1,
      replyWritesInWindow: 999,
    },
    'reply',
    now,
    TOPIC_REPLY_QUOTA.defaultLimit
  );

  assert.deepEqual(decision, {
    allowed: true,
    windowStartedAt: now,
    nextCount: 1,
  });
});
