import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityTopicRateWindow,
  resolveCommunityTopicAudience,
  resolveCommunityTopicWriteLimit,
} from './community-topic-write.policy';

test('audiência segue a visibilidade da Comunidade e falha fechada', () => {
  assert.equal(resolveCommunityTopicAudience('public_preview'), 'public_preview');
  assert.equal(resolveCommunityTopicAudience('members_only'), 'members_only');
  assert.equal(resolveCommunityTopicAudience(null), 'members_only');
  assert.equal(resolveCommunityTopicAudience('unexpected'), 'members_only');
});

test('usa limites padrão conservadores e aceita configuração controlada', () => {
  assert.equal(resolveCommunityTopicWriteLimit({}, 'topic'), 12);
  assert.equal(resolveCommunityTopicWriteLimit({}, 'reply'), 120);
  assert.equal(
    resolveCommunityTopicWriteLimit({ maxTopicCreationsPer24h: 20 }, 'topic'),
    20
  );
  assert.equal(
    resolveCommunityTopicWriteLimit({ maxTopicRepliesPer24h: 250 }, 'reply'),
    250
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
      replyWindowStartedAt: now - 25 * 60 * 60 * 1_000,
      replyWritesInWindow: 999,
    },
    'reply',
    now,
    120
  );

  assert.deepEqual(decision, {
    allowed: true,
    windowStartedAt: now,
    nextCount: 1,
  });
});
