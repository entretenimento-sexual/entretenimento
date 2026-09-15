// functions/src/community/community-feed-realtime-cleanup.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldDeleteCommunityFeedRealtimeProjection } from './community-feed-realtime-cleanup.policy';

test('projeção existente em Comunidade ativa continua sincronizável', () => {
  assert.equal(
    shouldDeleteCommunityFeedRealtimeProjection(true, { status: 'active' }),
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

test('arquivo e purge terminal apagam realtime mesmo com evento atrasado existente', () => {
  for (const status of ['archived', 'scheduled_for_deletion']) {
    assert.equal(
      shouldDeleteCommunityFeedRealtimeProjection(false, { status }),
      true
    );
    assert.equal(
      shouldDeleteCommunityFeedRealtimeProjection(true, { status }),
      true
    );
  }
});

test('Comunidade inexistente não recria tombstone ou projeção órfã', () => {
  assert.equal(
    shouldDeleteCommunityFeedRealtimeProjection(false, null),
    true
  );
  assert.equal(
    shouldDeleteCommunityFeedRealtimeProjection(true, null),
    true
  );
});
