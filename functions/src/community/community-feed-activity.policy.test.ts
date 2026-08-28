// functions/src/community/community-feed-activity.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { isCommunityFeedTransitionMeaningful } from './community-feed-activity.policy';

function projection(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'text',
    status: 'active',
    moderationState: 'active',
    metrics: { commentCount: 0, reactionCount: 0 },
    ...overrides,
  };
}

test('nova publicação ativa é atividade significativa', () => {
  assert.equal(
    isCommunityFeedTransitionMeaningful(null, projection()),
    true
  );
});

test('reativação de publicação moderada é atividade significativa', () => {
  assert.equal(
    isCommunityFeedTransitionMeaningful(
      projection({ status: 'hidden' }),
      projection()
    ),
    true
  );
});

test('crescimento de comentário ou reação renova atividade', () => {
  assert.equal(
    isCommunityFeedTransitionMeaningful(
      projection(),
      projection({ metrics: { commentCount: 1, reactionCount: 0 } })
    ),
    true
  );
  assert.equal(
    isCommunityFeedTransitionMeaningful(
      projection(),
      projection({ metrics: { commentCount: 0, reactionCount: 1 } })
    ),
    true
  );
});

test('edição sem novo engajamento não renova o relógio', () => {
  assert.equal(
    isCommunityFeedTransitionMeaningful(
      projection({ text: 'Antes' }),
      projection({ text: 'Depois' })
    ),
    false
  );
});

test('conteúdo oculto ou sem moderação ativa não conta como atividade', () => {
  assert.equal(
    isCommunityFeedTransitionMeaningful(
      null,
      projection({ moderationState: 'pending' })
    ),
    false
  );
});
