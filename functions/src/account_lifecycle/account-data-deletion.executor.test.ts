import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountBlockReferenceSummary,
  AccountDataDeletionAdapter,
  FriendRequestDirection,
  NotificationReferenceDirection,
  executeAccountDataDeletionDomains,
} from './account-data-deletion.executor';

class FakeAdapter implements AccountDataDeletionAdapter {
  recipientNotifications: number[] = [0];
  actorNotifications: number[] = [0];
  preferences = 0;
  presence = 0;
  privateLocation = 0;
  intentStatuses: number[] = [0];
  intentStatusAudit: number[] = [0];
  requesterRequests: number[] = [0];
  targetRequests: number[] = [0];
  communityMemberships: number[] = [0];
  ownedCommunityMemberships = 0;
  ownedFriendships: number[] = [0];
  inboundFriendships: number[] = [0];
  blockReferences: AccountBlockReferenceSummary = { owned: 0, inbound: 0 };
  notificationError: unknown = null;

  async deleteNotificationsPage(
    _uid: string,
    direction: NotificationReferenceDirection
  ): Promise<number> {
    if (this.notificationError) throw this.notificationError;
    return direction === 'recipient'
      ? this.recipientNotifications.shift() ?? 0
      : this.actorNotifications.shift() ?? 0;
  }

  async deletePreferences(): Promise<number> {
    return this.preferences;
  }

  async deletePresence(): Promise<number> {
    return this.presence;
  }

  async clearPrivateLocation(): Promise<number> {
    return this.privateLocation;
  }

  async deleteUserIntentStatusesPage(): Promise<number> {
    return this.intentStatuses.shift() ?? 0;
  }

  async deleteUserIntentStatusAuditPage(): Promise<number> {
    return this.intentStatusAudit.shift() ?? 0;
  }

  async deleteFriendRequestsPage(
    _uid: string,
    direction: FriendRequestDirection
  ): Promise<number> {
    return direction === 'requester'
      ? this.requesterRequests.shift() ?? 0
      : this.targetRequests.shift() ?? 0;
  }

  async unlinkCommunityMembershipsPage(): Promise<number> {
    return this.communityMemberships.shift() ?? 0;
  }

  async inspectOwnedCommunityMemberships(): Promise<number> {
    return this.ownedCommunityMemberships;
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

test('executor completes private, temporary and social domains idempotently', async () => {
  const adapter = new FakeAdapter();
  adapter.recipientNotifications = [2];
  adapter.actorNotifications = [3];
  adapter.preferences = 1;
  adapter.presence = 1;
  adapter.privateLocation = 1;
  adapter.intentStatuses = [1];
  adapter.intentStatusAudit = [2];
  adapter.requesterRequests = [1];
  adapter.targetRequests = [2];
  adapter.communityMemberships = [2];
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
    'presence_and_location',
    'friend_requests',
    'community_memberships',
    'relationship_edges',
  ]);
  assert.equal(result.results.every((item) => item.status === 'completed'), true);
  assert.equal(
    result.results.every((item) => !Object.hasOwn(item, 'blocker')),
    true
  );
});

test('notification domain removes recipient and actor references', async () => {
  const adapter = new FakeAdapter();
  adapter.recipientNotifications = [4];
  adapter.actorNotifications = [6];

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'user-notification',
    generatedAt: 1_800_000_000_000,
    pageSize: 20,
  });

  const notifications = result.results.find(
    (item) => item.domain === 'notifications'
  );

  assert.equal(notifications?.status, 'completed');
  assert.equal(notifications?.processed, 10);
  assert.deepEqual(notifications?.details, {
    recipientNotificationsProcessed: 4,
    actorNotificationsProcessed: 6,
  });
});

test('presence domain removes live presence, precise location and temporary statuses', async () => {
  const adapter = new FakeAdapter();
  adapter.presence = 1;
  adapter.privateLocation = 1;
  adapter.intentStatuses = [2];
  adapter.intentStatusAudit = [3];

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'user-presence',
    generatedAt: 1_800_000_000_000,
    pageSize: 10,
  });

  const presence = result.results.find(
    (item) => item.domain === 'presence_and_location'
  );

  assert.equal(presence?.status, 'completed');
  assert.equal(presence?.processed, 7);
  assert.deepEqual(presence?.details, {
    presenceDocumentsProcessed: 1,
    privateLocationDocumentsProcessed: 1,
    intentStatusesProcessed: 2,
    intentStatusAuditProcessed: 3,
  });
});

test('community memberships complete after all non-owner links are removed', async () => {
  const adapter = new FakeAdapter();
  adapter.communityMemberships = [3];

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'community-member',
    generatedAt: 1_800_000_000_000,
    pageSize: 10,
  });

  const memberships = result.results.find(
    (item) => item.domain === 'community_memberships'
  );

  assert.equal(memberships?.status, 'completed');
  assert.equal(memberships?.processed, 3);
  assert.deepEqual(memberships?.details, {
    membershipsProcessed: 3,
    ownerMemberships: 0,
  });
});

test('community ownership blocks account finalization until transfer or archive', async () => {
  const adapter = new FakeAdapter();
  adapter.communityMemberships = [2];
  adapter.ownedCommunityMemberships = 1;

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'community-owner',
    generatedAt: 1_800_000_000_000,
    pageSize: 10,
  });

  const memberships = result.results.find(
    (item) => item.domain === 'community_memberships'
  );

  assert.equal(memberships?.status, 'blocked');
  assert.equal(
    memberships?.blocker,
    'owner-transfer-or-community-archive-required'
  );
  assert.equal(
    result.completedDomains.includes('community_memberships'),
    false
  );
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

test('executor marks notification domain partial when pagination limit is reached', async () => {
  const adapter = new FakeAdapter();
  adapter.recipientNotifications = [2, 2];

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

test('presence domain remains partial while status pagination is incomplete', async () => {
  const adapter = new FakeAdapter();
  adapter.intentStatuses = [2, 2];

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'user-presence-partial',
    generatedAt: 1_800_000_000_000,
    pageSize: 2,
    maxPagesPerDomain: 2,
  });

  const presence = result.results.find(
    (item) => item.domain === 'presence_and_location'
  );

  assert.equal(presence?.status, 'partial');
  assert.equal(presence?.blocker, 'pagination-limit-reached');
  assert.equal(result.completedDomains.includes('presence_and_location'), false);
});

test('community membership domain remains partial at pagination limit', async () => {
  const adapter = new FakeAdapter();
  adapter.communityMemberships = [2, 2];

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'community-member-partial',
    generatedAt: 1_800_000_000_000,
    pageSize: 2,
    maxPagesPerDomain: 2,
  });

  const memberships = result.results.find(
    (item) => item.domain === 'community_memberships'
  );

  assert.equal(memberships?.status, 'partial');
  assert.equal(memberships?.blocker, 'pagination-limit-reached');
});

test('executor isolates a domain failure and continues the remaining domains', async () => {
  const adapter = new FakeAdapter();
  adapter.notificationError = { code: 'firestore/unavailable' };
  adapter.preferences = 1;
  adapter.presence = 1;

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
  assert.equal(result.completedDomains.includes('presence_and_location'), true);
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
