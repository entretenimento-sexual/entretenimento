// functions/src/community/community-feed-activity.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCommunityFeedTransitionMeaningful,
  resolveCommunityFeedInteractionDelta,
} from './community-feed-activity.policy';

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
  assert.equal(resolveCommunityFeedInteractionDelta(null, projection()), 0);
});

test('reativação de publicação moderada é atividade significativa sem fabricar interação', () => {
  const before = projection({ status: 'hidden' });
  const after = projection();

  assert.equal(isCommunityFeedTransitionMeaningful(before, after), true);
  assert.equal(resolveCommunityFeedInteractionDelta(before, after), 0);
});

test('crescimento de comentário ou reação renova atividade e retorna o delta real', () => {
  const before = projection({
    metrics: { commentCount: 3, reactionCount: 4 },
  });
  const after = projection({
    metrics: { commentCount: 5, reactionCount: 7 },
  });

  assert.equal(isCommunityFeedTransitionMeaningful(before, after), true);
  assert.equal(resolveCommunityFeedInteractionDelta(before, after), 5);
});

test('redução de métricas não vira atividade positiva', () => {
  const before = projection({
    metrics: { commentCount: 8, reactionCount: 9 },
  });
  const after = projection({
    metrics: { commentCount: 7, reactionCount: 5 },
  });

  assert.equal(isCommunityFeedTransitionMeaningful(before, after), false);
  assert.equal(resolveCommunityFeedInteractionDelta(before, after), 0);
});

test('limita saltos anormais de interação antes de atualizar o agregado', () => {
  const before = projection();
  const after = projection({
    metrics: { commentCount: 50_000, reactionCount: 50_000 },
  });

  assert.equal(resolveCommunityFeedInteractionDelta(before, after), 1_000);
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
