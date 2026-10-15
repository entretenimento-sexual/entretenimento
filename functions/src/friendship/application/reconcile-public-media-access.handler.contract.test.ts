import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const handler = readFileSync(
  resolve(__dirname, '../../../src/friendship/application/reconcile-public-media-access.handler.ts'),
  'utf8'
);

test('passive media reconciliation does not write a reverse visit trace', () => {
  assert.ok(handler.includes('tx.get(outgoingRef)'));
  assert.ok(handler.includes('tx.get(incomingRef)'));
  assert.ok(handler.includes('tx.set(viewerProjectionRef, projection)'));
  assert.ok(!handler.includes('ownerProjectionRef'));
});

test('reconciliation response contains no block direction or availability', () => {
  assert.ok(handler.includes('return { reconciled: true }'));
  assert.ok(handler.includes('consumeBackendRateLimitQuota'));
  assert.ok(handler.includes('assertPlatformAccountAccessData(viewer.data())'));
});
