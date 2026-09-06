// functions/src/community/community-discovery-membership-batch.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityDiscoveryMembershipBatchSize,
} from './community-discovery-membership-batch.policy';

test('primeiro lote lê somente a quantidade necessária para preencher a página', () => {
  assert.equal(
    resolveCommunityDiscoveryMembershipBatchSize({
      remainingCards: 1,
      candidatesEvaluated: 0,
      blockedExcluded: 0,
    }),
    1
  );

  assert.equal(
    resolveCommunityDiscoveryMembershipBatchSize({
      remainingCards: 12,
      candidatesEvaluated: 0,
      blockedExcluded: 0,
    }),
    12
  );
});

test('usa a taxa observada de bloqueios para dimensionar apenas o refill necessário', () => {
  assert.equal(
    resolveCommunityDiscoveryMembershipBatchSize({
      remainingCards: 1,
      candidatesEvaluated: 12,
      blockedExcluded: 1,
    }),
    2
  );

  assert.equal(
    resolveCommunityDiscoveryMembershipBatchSize({
      remainingCards: 4,
      candidatesEvaluated: 12,
      blockedExcluded: 4,
    }),
    6
  );
});

test('mantém lote limitado quando a amostra anterior foi totalmente bloqueada', () => {
  assert.equal(
    resolveCommunityDiscoveryMembershipBatchSize({
      remainingCards: 12,
      candidatesEvaluated: 12,
      blockedExcluded: 12,
    }),
    24
  );

  assert.equal(
    resolveCommunityDiscoveryMembershipBatchSize({
      remainingCards: 24,
      candidatesEvaluated: 24,
      blockedExcluded: 99,
    }),
    24
  );
});

test('normaliza entradas inválidas sem criar lote artificial', () => {
  assert.equal(
    resolveCommunityDiscoveryMembershipBatchSize({
      remainingCards: 0,
      candidatesEvaluated: 10,
      blockedExcluded: 2,
    }),
    0
  );

  assert.equal(
    resolveCommunityDiscoveryMembershipBatchSize({
      remainingCards: Number.NaN,
      candidatesEvaluated: -1,
      blockedExcluded: -1,
    }),
    0
  );
});
