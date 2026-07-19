import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountBlockReferenceSummary,
  AccountDataDeletionAdapter,
  FriendRequestDirection,
  executeAccountDataDeletionDomains,
} from './account-data-deletion.executor';

class FakeAdapter implements AccountDataDeletionAdapter {
  notifications: number[] = [0];
  preferences = 0;
  requesterRequests: number[] = [0];
  targetRequests: number[] = [0];
  ownedFriendships: number[] = [0];
  inboundFriendships: number[] = [0];
  blockReferences: AccountBlockReferenceSummary = { owned: 0, inbound: 0 };
  notificationError: unknown = null;

  async deleteNotificationsPage(): Promise<number> {
    if (this.notificationError) throw this.notificationError;
    return this.notifications.shift() ?? 0;
  }

  async deletePreferences(): Promise<number> {
    return this.preferences;
  }

  async deleteFriendRequestsPage(
    _uid: string,
    direction: FriendRequestDirection
  ): Promise<number> {
    return direction === 'requester'
      ? this.requesterRequests.shift() ?? 0
      : this.targetRequests.shift() ?? 0;
  }

  async unlinkOwnedFriendshipsPage(): Promise<number> {
    return this.ownedFriendships.shift() ?? 0;
  }

  async deleteInboundFriendshipReferencesPage(): Promise<number> {
    return this.inboundFriendships.shift() ?? 0;
  }

  async inspectBlockReferences(): Promise<AccountBlockReferenceSummary> {
    return this.blockReferences;
  }
}

test('executor completes notifications, preferences, requests and friendships idempotently', async () => {
  const adapter = new FakeAdapter();
  adapter.notifications = [2];
  adapter.preferences = 1;
  adapter.requesterRequests = [1];
  adapter.targetRequests = [2];
  adapter.ownedFriendships = [3];
  adapter.inboundFriendships = [1];

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'user-1',
    generatedAt: 1_800_000_000_000,
    pageSize: 10,
    maxPagesPerDomain: 3,
  });

  assert.deepEqual(result.completedDomains, [
    'notifications',
    'preferences',
    'friend_requests',
    'relationship_edges',
  ]);
  assert.equal(result.results.every((item) => item.status === 'completed'), true);
});

test('executor keeps relationship domain blocked while block history exists', async () => {
  const adapter = new FakeAdapter();
  adapter.blockReferences = { owned: 1, inbound: 1 };

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'user-2',
    generatedAt: 1_800_000_000_000,
  });

  const relationship = result.results.find(
    (item) => item.domain === 'relationship_edges'
  );

  assert.equal(relationship?.status, 'blocked');
  assert.equal(
    relationship?.blocker,
    'block-event-retention-contract-required'
  );
  assert.equal(result.completedDomains.includes('relationship_edges'), false);
});

test('executor marks a domain partial when pagination limit is reached', async () => {
  const adapter = new FakeAdapter();
  adapter.notifications = [2, 2];

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'user-3',
    generatedAt: 1_800_000_000_000,
    pageSize: 2,
    maxPagesPerDomain: 2,
  });

  const notifications = result.results.find(
    (item) => item.domain === 'notifications'
  );

  assert.equal(notifications?.status, 'partial');
  assert.equal(notifications?.processed, 4);
  assert.equal(notifications?.blocker, 'pagination-limit-reached');
  assert.equal(result.completedDomains.includes('notifications'), false);
});

test('executor isolates a domain failure and continues the remaining domains', async () => {
  const adapter = new FakeAdapter();
  adapter.notificationError = { code: 'firestore/unavailable' };
  adapter.preferences = 1;

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'user-4',
    generatedAt: 1_800_000_000_000,
  });

  const notifications = result.results.find(
    (item) => item.domain === 'notifications'
  );

  assert.equal(notifications?.status, 'failed');
  assert.equal(notifications?.errorCode, 'firestore/unavailable');
  assert.equal(result.completedDomains.includes('notifications'), false);
  assert.equal(result.completedDomains.includes('preferences'), true);
});

test('executor rejects an empty uid before any deletion attempt', async () => {
  const adapter = new FakeAdapter();

  await assert.rejects(
    executeAccountDataDeletionDomains(adapter, {
      uid: '   ',
      generatedAt: 1_800_000_000_000,
    }),
    /UID inválido/
  );
});
