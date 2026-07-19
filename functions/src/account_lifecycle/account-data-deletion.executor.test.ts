import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountBlockReferenceSummary,
  AccountDataDeletionAdapter,
  FriendRequestDirection,
  NotificationReferenceDirection,
  RoomInviteDirection,
  RoomParticipationPageSummary,
  executeAccountDataDeletionDomains,
} from './account-data-deletion.executor';

const EMPTY_ROOM_PAGE: RoomParticipationPageSummary = {
  scanned: 0,
  processed: 0,
  blockingOwners: 0,
};

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
  sentRoomInvites: number[] = [0];
  receivedRoomInvites: number[] = [0];
  legacyRoomParticipations: RoomParticipationPageSummary[] = [
    { ...EMPTY_ROOM_PAGE },
  ];
  roomMemberships: RoomParticipationPageSummary[] = [
    { ...EMPTY_ROOM_PAGE },
  ];
  roomParticipantDocuments: RoomParticipationPageSummary[] = [
    { ...EMPTY_ROOM_PAGE },
  ];
  ownedRoomReferences: RoomParticipationPageSummary[] = [
    { ...EMPTY_ROOM_PAGE },
  ];
  roomAudit: number[] = [0];
  privateRoomReferences = 0;
  ownedFriendships: number[] = [0];
  inboundFriendships: number[] = [0];
  blockReferences: AccountBlockReferenceSummary = { owned: 0, inbound: 0 };
  notificationError: unknown = null;
  roomError: unknown = null;

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

  async deleteRoomInvitesPage(
    _uid: string,
    direction: RoomInviteDirection
  ): Promise<number> {
    if (this.roomError) throw this.roomError;
    return direction === 'sender'
      ? this.sentRoomInvites.shift() ?? 0
      : this.receivedRoomInvites.shift() ?? 0;
  }

  async unlinkRoomParticipationsPage(): Promise<RoomParticipationPageSummary> {
    return this.legacyRoomParticipations.shift() ?? { ...EMPTY_ROOM_PAGE };
  }

  async unlinkRoomMembershipsPage(): Promise<RoomParticipationPageSummary> {
    return this.roomMemberships.shift() ?? { ...EMPTY_ROOM_PAGE };
  }

  async deleteRoomParticipantDocumentsPage(): Promise<RoomParticipationPageSummary> {
    return this.roomParticipantDocuments.shift() ?? { ...EMPTY_ROOM_PAGE };
  }

  async resolveOwnedRoomReferencesPage(): Promise<RoomParticipationPageSummary> {
    return this.ownedRoomReferences.shift() ?? { ...EMPTY_ROOM_PAGE };
  }

  async anonymizeRoomAuditPage(): Promise<number> {
    return this.roomAudit.shift() ?? 0;
  }

  async clearPrivateRoomReferences(): Promise<number> {
    return this.privateRoomReferences;
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
  adapter.sentRoomInvites = [2];
  adapter.receivedRoomInvites = [1];
  adapter.legacyRoomParticipations = [
    { scanned: 2, processed: 2, blockingOwners: 0 },
  ];
  adapter.roomMemberships = [
    { scanned: 1, processed: 1, blockingOwners: 0 },
  ];
  adapter.roomParticipantDocuments = [
    { scanned: 1, processed: 1, blockingOwners: 0 },
  ];
  adapter.ownedRoomReferences = [
    { scanned: 1, processed: 1, blockingOwners: 0 },
  ];
  adapter.roomAudit = [2];
  adapter.privateRoomReferences = 1;
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
    'room_participation',
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

test('room participation removes invites and all transitional membership projections', async () => {
  const adapter = new FakeAdapter();
  adapter.sentRoomInvites = [3];
  adapter.receivedRoomInvites = [2];
  adapter.legacyRoomParticipations = [
    { scanned: 2, processed: 2, blockingOwners: 0 },
  ];
  adapter.roomMemberships = [
    { scanned: 1, processed: 1, blockingOwners: 0 },
  ];
  adapter.roomParticipantDocuments = [
    { scanned: 1, processed: 1, blockingOwners: 0 },
  ];
  adapter.ownedRoomReferences = [
    { scanned: 1, processed: 1, blockingOwners: 0 },
  ];
  adapter.roomAudit = [2];
  adapter.privateRoomReferences = 1;

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'room-member',
    generatedAt: 1_800_000_000_000,
    pageSize: 10,
  });

  const roomParticipation = result.results.find(
    (item) => item.domain === 'room_participation'
  );

  assert.equal(roomParticipation?.status, 'completed');
  assert.equal(roomParticipation?.processed, 13);
  assert.deepEqual(roomParticipation?.details, {
    sentInvitesProcessed: 3,
    receivedInvitesProcessed: 2,
    legacyRoomParticipationsProcessed: 2,
    roomMembershipsProcessed: 1,
    roomParticipantDocumentsProcessed: 1,
    ownedRoomReferencesProcessed: 1,
    roomAuditRecordsProcessed: 2,
    privateRoomReferencesProcessed: 1,
    blockingOwnedRooms: 0,
  });
});

test('active room ownership blocks finalization until the room is closed or transferred', async () => {
  const adapter = new FakeAdapter();
  adapter.ownedRoomReferences = [
    { scanned: 1, processed: 0, blockingOwners: 1 },
  ];

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'room-owner',
    generatedAt: 1_800_000_000_000,
    pageSize: 10,
  });

  const roomParticipation = result.results.find(
    (item) => item.domain === 'room_participation'
  );

  assert.equal(roomParticipation?.status, 'blocked');
  assert.equal(
    roomParticipation?.blocker,
    'active-room-owner-close-or-transfer-required'
  );
  assert.equal(
    result.completedDomains.includes('room_participation'),
    false
  );
});

test('room participation remains partial when a projection reaches pagination limit', async () => {
  const adapter = new FakeAdapter();
  adapter.roomMemberships = [
    { scanned: 2, processed: 2, blockingOwners: 0 },
    { scanned: 2, processed: 2, blockingOwners: 0 },
  ];

  const result = await executeAccountDataDeletionDomains(adapter, {
    uid: 'room-member-partial',
    generatedAt: 1_800_000_000_000,
    pageSize: 2,
    maxPagesPerDomain: 2,
  });

  const roomParticipation = result.results.find(
    (item) => item.domain === 'room_participation'
  );

  assert.equal(roomParticipation?.status, 'partial');
  assert.equal(roomParticipation?.blocker, 'pagination-limit-reached');
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
  assert.equal(result.completedDomains.includes('room_participation'), true);
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
