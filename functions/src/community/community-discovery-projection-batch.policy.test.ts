// functions/src/community/community-discovery-projection-batch.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityDiscoveryProjectionBatchSize,
} from './community-discovery-projection-batch.policy';

test('começa com a página mais um sentinel em vez de triplicar a leitura', () => {
  assert.equal(
    resolveCommunityDiscoveryProjectionBatchSize({
      remainingCards: 1,
      remainingScanBudget: 4,
      projectionDocumentsConsumed: 0,
      cardsReturned: 0,
    }),
    2
  );

  assert.equal(
    resolveCommunityDiscoveryProjectionBatchSize({
      remainingCards: 12,
      remainingScanBudget: 37,
      projectionDocumentsConsumed: 0,
      cardsReturned: 0,
    }),
    13
  );

  assert.equal(
    resolveCommunityDiscoveryProjectionBatchSize({
      remainingCards: 24,
      remainingScanBudget: 73,
      projectionDocumentsConsumed: 0,
      cardsReturned: 0,
    }),
    25
  );
});

test('amplia somente o refill conforme a taxa observada de entrega', () => {
  assert.equal(
    resolveCommunityDiscoveryProjectionBatchSize({
      remainingCards: 1,
      remainingScanBudget: 24,
      projectionDocumentsConsumed: 12,
      cardsReturned: 11,
    }),
    3
  );

  assert.equal(
    resolveCommunityDiscoveryProjectionBatchSize({
      remainingCards: 4,
      remainingScanBudget: 24,
      projectionDocumentsConsumed: 12,
      cardsReturned: 8,
    }),
    7
  );
});

test('limita a expansão quando a amostra anterior teve baixa entrega', () => {
  assert.equal(
    resolveCommunityDiscoveryProjectionBatchSize({
      remainingCards: 12,
      remainingScanBudget: 25,
      projectionDocumentsConsumed: 12,
      cardsReturned: 0,
    }),
    25
  );

  assert.equal(
    resolveCommunityDiscoveryProjectionBatchSize({
      remainingCards: 12,
      remainingScanBudget: 8,
      projectionDocumentsConsumed: 12,
      cardsReturned: 0,
    }),
    8
  );
});

test('normaliza entradas inválidas e respeita orçamento esgotado', () => {
  assert.equal(
    resolveCommunityDiscoveryProjectionBatchSize({
      remainingCards: 0,
      remainingScanBudget: 37,
      projectionDocumentsConsumed: 0,
      cardsReturned: 0,
    }),
    0
  );

  assert.equal(
    resolveCommunityDiscoveryProjectionBatchSize({
      remainingCards: 12,
      remainingScanBudget: 0,
      projectionDocumentsConsumed: 12,
      cardsReturned: 12,
    }),
    0
  );

  assert.equal(
    resolveCommunityDiscoveryProjectionBatchSize({
      remainingCards: Number.NaN,
      remainingScanBudget: -1,
      projectionDocumentsConsumed: -1,
      cardsReturned: -1,
    }),
    0
  );
});
