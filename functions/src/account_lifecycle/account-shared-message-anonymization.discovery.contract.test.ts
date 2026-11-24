import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const base = path.resolve(__dirname, '../../src');
const backfill = readFileSync(path.join(base,
  'chat/direct-chat/application/direct-chat-discovery.backfill.ts'), 'utf8');
const lifecycle = readFileSync(path.join(base,
  'account_lifecycle/account-shared-message-anonymization.firestore.ts'), 'utf8');
const executor = readFileSync(path.join(base,
  'account_lifecycle/account-shared-message-anonymization.executor.ts'), 'utf8');
const ensure = readFileSync(path.join(base,
  'chat/direct-chat/application/ensure-direct-chat.handler.ts'), 'utf8');

test('CHAT-R1.3 keeps historical discovery independent of friendship and messaging', () => {
  assert.match(backfill, /reconcileHistoricalDirectChatDiscovery/);
  assert.match(backfill, /isEligibleExistingDirectChat/);
  assert.match(backfill, /multiple-histories/);
  assert.match(backfill, /canonical-registry-conflict/);
  assert.match(backfill, /stageDirectChatDiscoveryReferences/);
  assert.doesNotMatch(backfill, /\.collection\('friends'\)/);
  assert.doesNotMatch(backfill, /\.collection\('messages'\)/);
  assert.match(ensure, /assertCanCreateNewDirectChat/);
  assert.match(ensure, /assertNoDirectMessagingBlock/);
});

test('CHAT-R1.3 purges discovery refs before finalization, leaving shared messages intact', () => {
  assert.match(lifecycle, /async anonymizeDirectChatsPage[\s\S]*transaction\.delete\([\s\S]*direct_chat_discovery/);
  assert.match(lifecycle, /async deleteDirectChatDiscoveryReferencesPage[\s\S]*deleteDocumentRefs/);
  assert.match(executor,
    /await executePagedStep\(\s*\(\) => adapter\.deleteDirectChatDiscoveryReferencesPage\(uid, pageSize\)/);
  assert.match(executor, /directChatDiscoveryReferencesDeleted/);
});
