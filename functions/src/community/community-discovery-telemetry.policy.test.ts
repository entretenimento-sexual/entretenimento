// functions/src/community/community-discovery-telemetry.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityDiscoveryTelemetry,
} from './community-discovery-telemetry.policy';

test('calcula amplificação e custo de entrega sem identificadores do viewer', () => {
  const telemetry = buildCommunityDiscoveryTelemetry({
    requestedLimit: 12,
    scanLimit: 37,
    projectionDocumentsFetched: 30,
    projectionDocumentsConsumed: 18,
    candidatesEvaluated: 16,
    membershipReads: 16,
    membershipBatches: 2,
    blockedExcluded: 4,
    cardsReturned: 12,
    cursorProjectionReads: 1,
    durationMs: 147,
    hasCursor: true,
    hasTagFilter: true,
    sourceType: 'community',
    rankingMode: 'score_v2',
    hasNextPage: true,
  });

  assert.equal(telemetry['deliveryFirestoreReads'], 47);
  assert.equal(telemetry['projectionReadAmplification'], 2.5);
  assert.equal(telemetry['membershipReadAmplification'], 1.33);
  assert.equal(telemetry['deliveryReadAmplification'], 3.92);
  assert.equal(telemetry['blockedExcluded'], 4);
  assert.equal(telemetry['durationMs'], 147);

  for (const forbiddenKey of ['uid', 'communityId', 'tagId', 'cursor']) {
    assert.equal(forbiddenKey in telemetry, false);
  }
});

test('evita divisão artificial quando nenhuma carta é retornada', () => {
  const telemetry = buildCommunityDiscoveryTelemetry({
    requestedLimit: 12,
    scanLimit: 37,
    projectionDocumentsFetched: 9,
    projectionDocumentsConsumed: 9,
    candidatesEvaluated: 6,
    membershipReads: 6,
    membershipBatches: 1,
    blockedExcluded: 6,
    cardsReturned: 0,
    cursorProjectionReads: 0,
    durationMs: 30,
    hasCursor: false,
    hasTagFilter: false,
    sourceType: null,
    rankingMode: '',
    hasNextPage: false,
  });

  assert.equal(telemetry['projectionReadAmplification'], null);
  assert.equal(telemetry['membershipReadAmplification'], null);
  assert.equal(telemetry['deliveryReadAmplification'], null);
  assert.equal(telemetry['deliveryFirestoreReads'], 15);
  assert.equal(telemetry['rankingMode'], 'unknown');
});
