// functions/src/community/community-discovery-telemetry.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_DISCOVERY_COST_SEMANTICS,
  buildCommunityDiscoveryTelemetry,
} from './community-discovery-telemetry.policy';

const SAFE_TELEMETRY_KEYS = [
  'blockedExcluded',
  'candidatesEvaluated',
  'cardsReturned',
  'costSemantics',
  'cursorProjectionReads',
  'deliveryDocumentReadProxy',
  'deliveryReadAmplification',
  'durationMs',
  'hasCursor',
  'hasNextPage',
  'hasTagFilter',
  'membershipBatches',
  'membershipReadAmplification',
  'membershipReads',
  'projectionDocumentsConsumed',
  'projectionDocumentsFetched',
  'projectionReadAmplification',
  'rankingMode',
  'requestedLimit',
  'scanLimit',
  'schemaVersion',
  'sourceType',
].sort();

const FORBIDDEN_TELEMETRY_KEYS = [
  'uid',
  'viewerUid',
  'email',
  'auth',
  'token',
  'communityId',
  'tagId',
  'cursor',
  'kyc',
  'kyb',
  'aml',
  'interests',
  'content',
  'description',
];

test('calcula amplificação como proxy operacional sem simular billing', () => {
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

  assert.equal(telemetry['schemaVersion'], 2);
  assert.equal(
    telemetry['costSemantics'],
    COMMUNITY_DISCOVERY_COST_SEMANTICS
  );
  assert.equal(telemetry['deliveryDocumentReadProxy'], 47);
  assert.equal(telemetry['projectionReadAmplification'], 2.5);
  assert.equal(telemetry['membershipReadAmplification'], 1.33);
  assert.equal(telemetry['deliveryReadAmplification'], 3.92);
  assert.equal(telemetry['blockedExcluded'], 4);
  assert.equal(telemetry['durationMs'], 147);
});

test('mantém contrato de telemetria restrito a campos operacionais seguros', () => {
  const telemetry = buildCommunityDiscoveryTelemetry({
    requestedLimit: 24,
    scanLimit: 73,
    projectionDocumentsFetched: 24,
    projectionDocumentsConsumed: 20,
    candidatesEvaluated: 19,
    membershipReads: 19,
    membershipBatches: 1,
    blockedExcluded: 2,
    cardsReturned: 17,
    cursorProjectionReads: 0,
    durationMs: 81,
    hasCursor: false,
    hasTagFilter: false,
    sourceType: 'venue',
    rankingMode: 'legacy',
    hasNextPage: false,
  });

  assert.deepEqual(Object.keys(telemetry).sort(), SAFE_TELEMETRY_KEYS);

  for (const forbiddenKey of FORBIDDEN_TELEMETRY_KEYS) {
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
    rankingMode: 'legacy',
    hasNextPage: false,
  });

  assert.equal(telemetry['projectionReadAmplification'], null);
  assert.equal(telemetry['membershipReadAmplification'], null);
  assert.equal(telemetry['deliveryReadAmplification'], null);
  assert.equal(telemetry['deliveryDocumentReadProxy'], 15);
  assert.equal(telemetry['rankingMode'], 'legacy');
});
