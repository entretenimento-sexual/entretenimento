import assert from 'node:assert/strict';
import { test } from 'node:test';

import { summarizePublishedAssetCleanupResults } from './video-deletion-published-cleanup.policy';

test('completed published video and poster permit completion', () => {
  assert.equal(summarizePublishedAssetCleanupResults('DELETED', 'DELETED'), 'DELETED');
});

test('a durable recovery handoff permits parent completion with pending cleanup', () => {
  assert.equal(summarizePublishedAssetCleanupResults('QUEUED_FOR_RETRY', 'DELETED'), 'QUEUED_FOR_RETRY');
  assert.equal(summarizePublishedAssetCleanupResults('DELETED', 'QUEUED_FOR_RETRY'), 'QUEUED_FOR_RETRY');
  assert.equal(summarizePublishedAssetCleanupResults('QUEUED_FOR_RETRY', 'QUEUED_FOR_RETRY'), 'QUEUED_FOR_RETRY');
});

test('active reference or invalid path blocks parent completion even with queued work', () => {
  assert.equal(summarizePublishedAssetCleanupResults('ACTIVE_REFERENCE', 'DELETED'), 'BLOCKED');
  assert.equal(summarizePublishedAssetCleanupResults('QUEUED_FOR_RETRY', 'ACTIVE_REFERENCE'), 'BLOCKED');
  assert.equal(summarizePublishedAssetCleanupResults('INVALID_PATH', 'DELETED'), 'BLOCKED');
  assert.equal(summarizePublishedAssetCleanupResults('DELETED', 'INVALID_PATH'), 'BLOCKED');
});
