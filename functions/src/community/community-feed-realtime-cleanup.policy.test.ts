// functions/src/community/community-feed-realtime-cleanup.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldDeleteCommunityFeedRealtimeProjection } from './community-feed-realtime-cleanup.policy';

test('mantém realtime quando a projeção pública continua existindo', () => {
  assert.equal(
    shouldDeleteCommunityFeedRealtimeProjection(true, { status: 'archived' }),
    false
  );
});

test('remoção em Comunidade ativa continua usando tombstone', () => {
  assert.equal(
    shouldDeleteCommunityFeedRealtimeProjection(false, { status: 'active' }),
    false
  );
});

test('remoção em Comunidade dormente continua usando tombstone', () => {
  assert.equal(
    shouldDeleteCommunityFeedRealtimeProjection(false, { status: 'dormant' }),
    false
  );
});

test('arquivo e purge terminal apagam o realtime definitivamente', () => {
  assert.equal(
    shouldDeleteCommunityFeedRealtimeProjection(false, { status: 'archived' }),
    true
  );
  assert.equal(
    shouldDeleteCommunityFeedRealtimeProjection(
      false,
      { status: 'scheduled_for_deletion' }
    ),
    true
  );
});

test('Comunidade inexistente não recria tombstone órfão', () => {
  assert.equal(
    shouldDeleteCommunityFeedRealtimeProjection(false, null),
    true
  );
});
