import assert from 'node:assert/strict';
import test from 'node:test';

import {
  executeSharedMessageAnonymizationDomain,
  type AccountSharedMessageAnonymizationAdapter,
  type SharedMessageIdentityField,
} from './account-shared-message-anonymization.executor';

class FakeSharedMessageAdapter
implements AccountSharedMessageAnonymizationAdapter
{
  identities: Record<SharedMessageIdentityField, number[]> = {
    senderId: [0],
    senderUid: [0],
    recipientUid: [0],
  };
  reactions: number[] = [0];
  chats: number[] = [0];
  pairs: number[] = [0];
  error: unknown = null;

  async anonymizeMessageIdentityPage(
    _uid: string,
    field: SharedMessageIdentityField
  ): Promise<number> {
    if (this.error) throw this.error;
    return this.identities[field].shift() ?? 0;
  }

  async removeMessageReactionsPage(): Promise<number> {
    return this.reactions.shift() ?? 0;
  }

  async anonymizeDirectChatsPage(): Promise<number> {
    return this.chats.shift() ?? 0;
  }

  async deleteDirectChatPairReferencesPage(): Promise<number> {
    return this.pairs.shift() ?? 0;
  }
}

test('shared message domain anonymizes identities, reactions and direct chat metadata', async () => {
  const adapter = new FakeSharedMessageAdapter();
  adapter.identities = {
    senderId: [3],
    senderUid: [1],
    recipientUid: [4],
  };
  adapter.reactions = [2];
  adapter.chats = [2];
  adapter.pairs = [1];

  const result = await executeSharedMessageAnonymizationDomain(adapter, {
    uid: 'message-owner',
    pageSize: 10,
    maxPagesPerStep: 3,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.processed, 13);
  assert.deepEqual(result.details, {
    senderIdMessagesAnonymized: 3,
    senderUidMessagesAnonymized: 1,
    recipientMessagesAnonymized: 4,
    messageReactionsRemoved: 2,
    directChatsAnonymized: 2,
    directChatPairReferencesDeleted: 1,
  });
});

test('pagination limit keeps shared messages blocked as partial', async () => {
  const adapter = new FakeSharedMessageAdapter();
  adapter.identities.senderId = [2, 2];

  const result = await executeSharedMessageAnonymizationDomain(adapter, {
    uid: 'message-pagination-owner',
    pageSize: 2,
    maxPagesPerStep: 2,
  });

  assert.equal(result.status, 'partial');
  assert.equal(result.blocker, 'pagination-limit-reached');
  assert.equal(result.details?.['senderIdMessagesAnonymized'], 4);
});

test('adapter errors remain isolated in shared message domain', async () => {
  const adapter = new FakeSharedMessageAdapter();
  adapter.error = Object.assign(new Error('query unavailable'), {
    code: 'firestore/unavailable',
  });

  const result = await executeSharedMessageAnonymizationDomain(adapter, {
    uid: 'message-error-owner',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.errorCode, 'firestore/unavailable');
  assert.equal(result.details?.['errorMessage'], 'query unavailable');
});

test('invalid uid fails before any shared message query', async () => {
  const adapter = new FakeSharedMessageAdapter();

  const result = await executeSharedMessageAnonymizationDomain(adapter, {
    uid: '../invalid',
  });

  assert.equal(result.status, 'failed');
  assert.deepEqual(adapter.identities.senderId, [0]);
});
