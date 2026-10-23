import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const handler = readFileSync(
  resolve(__dirname, '../../../../src/chat/direct-chat/application/send-direct-video-reference.handler.ts'),
  'utf8'
);

test('chat video references enforce the author block boundary for both participants', () => {
  assert.match(handler, /await assertNoActiveBilateralBlocksInTransaction\(\s*transaction,\s*requestedReference\.ownerUid,\s*\[actorUid, targetUid\]/);
  const checkedAt = handler.indexOf('await assertNoActiveBilateralBlocksInTransaction(');
  const resolvedAt = handler.indexOf('resolveStoredDirectMessagePublicVideoReference({');
  const persistedAt = handler.indexOf('transaction.create(messageRef,');
  assert.ok(checkedAt >= 0);
  assert.ok(checkedAt < resolvedAt);
  assert.ok(resolvedAt < persistedAt);
});

test('direct video chat persists references and not signed playback URLs', () => {
  assert.ok(handler.includes('publicVideoReference: storedReference'));
  assert.ok(handler.includes('assertAcceptedFriendship('));
  assert.ok(handler.includes('assertNoDirectMessagingBlock('));
  assert.ok(!handler.includes('publicVideoReference: { url:'));
  assert.ok(!handler.includes('publishedStoragePath:'));
});
