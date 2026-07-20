// functions/src/account_lifecycle/account-data-deletion.firestore.ts
// -----------------------------------------------------------------------------
// FIRESTORE ADAPTER FOR ACCOUNT DATA DELETION
// -----------------------------------------------------------------------------
// Implementa somente domínios cujo contrato já está definido.
// Não toca em mensagens, mídias, denúncias, billing ou eventos de bloqueio.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';

import { db, FieldValue } from '../firebaseApp';
import type {
  AccountBlockReferenceSummary,
  AccountDataDeletionAdapter,
  FriendRequestDirection,
  NotificationReferenceDirection,
  RoomInviteDirection,
  RoomParticipationPageSummary,
} from './account-data-deletion.executor';

const MAX_BATCH_WRITES = 450;
const COMMUNITY_MEMBER_ROLES = ['member', 'admin', 'moderator'] as const;
const ROOM_MEMBER_ROLES = ['member', 'admin', 'moderator'] as const;
const TERMINAL_ROOM_STATUSES = new Set(['closed', 'archived']);

interface RoomReferenceMutationResult {
  processed: number;
  blockingOwners: number;
}

export class FirestoreAccountDataDeletionAdapter implements AccountDataDeletionAdapter {
  async deleteNotificationsPage(
    uid: string,
    direction: NotificationReferenceDirection,
    limit: number
  ): Promise<number> {
    const field = direction === 'recipient' ? 'userId' : 'actorUid';
    const snapshot = await db
      .collection('notifications')
      .where(field, '==', uid)
      .limit(limit)
      .get();

    await this.deleteDocumentRefs(snapshot.docs.map((doc) => doc.ref));
    return snapshot.size;
  }

  async deletePreferences(uid: string): Promise<number> {
    const ref = db.collection('preferences').doc(uid);
    const snapshot = await ref.get();

    if (!snapshot.exists) return 0;

    await ref.delete();
    return 1;
  }

  async deletePresence(uid: string): Promise<number> {
    const ref = db.collection('presence').doc(uid);
    const snapshot = await ref.get();

    if (!snapshot.exists) return 0;

    await ref.delete();
    return 1;
  }

  async clearPrivateLocation(uid: string): Promise<number> {
    const ref = db.collection('users').doc(uid);
    const snapshot = await ref.get();

    if (!snapshot.exists) return 0;

    const data = snapshot.data() ?? {};
    const locationFields = [
      'latitude',
      'longitude',
      'geohash',
      'locationUpdatedAt',
    ];
    const hasLocationField = locationFields.some((field) =>
      Object.prototype.hasOwnProperty.call(data, field)
    );

    if (!hasLocationField) return 0;

    await ref.set(
      {
        latitude: FieldValue.delete(),
        longitude: FieldValue.delete(),
        geohash: FieldValue.delete(),
        locationUpdatedAt: FieldValue.delete(),
      },
      { merge: true }
    );

    return 1;
  }

  async deleteUserIntentStatusesPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const snapshot = await db
      .collection('user_intent_statuses')
      .where('uid', '==', uid)
      .limit(limit)
      .get();

    await this.deleteDocumentRefs(snapshot.docs.map((doc) => doc.ref));
    return snapshot.size;
  }

  async deleteUserIntentStatusAuditPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const snapshot = await db
      .collection('user_intent_status_audit')
      .where('actorUid', '==', uid)
      .limit(limit)
      .get();

    await this.deleteDocumentRefs(snapshot.docs.map((doc) => doc.ref));
    return snapshot.size;
  }

  async deleteFriendRequestsPage(
    uid: string,
    direction: FriendRequestDirection,
    limit: number
  ): Promise<number> {
    const field = direction === 'requester' ? 'requesterUid' : 'targetUid';
    const snapshot = await db
      .collection('friendRequests')
      .where(field, '==', uid)
      .limit(limit)
      .get();

    await this.deleteDocumentRefs(snapshot.docs.map((doc) => doc.ref));
    return snapshot.size;
  }

  async unlinkCommunityMembershipsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const snapshot = await db
      .collectionGroup('members')
      .where('uid', '==', uid)
      .where('role', 'in', [...COMMUNITY_MEMBER_ROLES])
      .limit(limit)
      .get();

    for (const membershipSnapshot of snapshot.docs) {
      const communityId = this.resolveCommunityMembershipPath(
        membershipSnapshot.ref.path,
        uid
      );

      await this.unlinkCommunityMembership(uid, communityId);
    }

    return snapshot.size;
  }

  async inspectOwnedCommunityMemberships(uid: string): Promise<number> {
    const snapshot = await db
      .collectionGroup('members')
      .where('uid', '==', uid)
      .where('role', '==', 'owner')
      .limit(10)
      .get();

    snapshot.docs.forEach((membershipSnapshot) => {
      this.resolveCommunityMembershipPath(membershipSnapshot.ref.path, uid);
    });

    return snapshot.size;
  }

  async deleteRoomInvitesPage(
    uid: string,
    direction: RoomInviteDirection,
    limit: number
  ): Promise<number> {
    const field = direction === 'sender' ? 'senderId' : 'receiverId';
    const snapshot = await db
      .collection('invites')
      .where(field, '==', uid)
      .limit(limit)
      .get();

    await this.deleteDocumentRefs(snapshot.docs.map((doc) => doc.ref));
    return snapshot.size;
  }

  async unlinkRoomParticipationsPage(
    uid: string,
    limit: number
  ): Promise<RoomParticipationPageSummary> {
    const snapshot = await db
      .collection('rooms')
      .where('participants', 'array-contains', uid)
      .limit(limit)
      .get();

    return this.processRoomReferences(
      uid,
      snapshot.docs.map((doc) => doc.id)
    );
  }

  async unlinkRoomMembershipsPage(
    uid: string,
    limit: number
  ): Promise<RoomParticipationPageSummary> {
    const snapshot = await db
      .collectionGroup('members')
      .where('uid', '==', uid)
      .where('membershipRole', 'in', [...ROOM_MEMBER_ROLES])
      .limit(limit)
      .get();
    const roomIds = snapshot.docs.map((membershipSnapshot) =>
      this.resolveRoomReferencePath(
        membershipSnapshot.ref.path,
        uid,
        'members'
      )
    );

    return this.processRoomReferences(uid, roomIds, snapshot.size);
  }

  async deleteRoomParticipantDocumentsPage(
    uid: string,
    limit: number
  ): Promise<RoomParticipationPageSummary> {
    const snapshot = await db
      .collectionGroup('participants')
      .where('uid', '==', uid)
      .limit(limit)
      .get();
    const roomIds = snapshot.docs.map((participantSnapshot) =>
      this.resolveRoomReferencePath(
        participantSnapshot.ref.path,
        uid,
        'participants'
      )
    );

    return this.processRoomReferences(uid, roomIds, snapshot.size);
  }

  async resolveOwnedRoomReferencesPage(
    uid: string,
    limit: number
  ): Promise<RoomParticipationPageSummary> {
    const snapshot = await db
      .collection('rooms')
      .where('createdBy', '==', uid)
      .limit(limit)
      .get();
    const roomResult = await this.processRoomReferences(
      uid,
      snapshot.docs.map((doc) => doc.id),
      snapshot.size
    );
    const slotResult = await this.resolveOwnerSlot(uid);

    return {
      scanned: roomResult.scanned,
      processed: roomResult.processed + slotResult.processed,
      blockingOwners:
        roomResult.blockingOwners + slotResult.blockingOwners,
    };
  }

  async anonymizeRoomAuditPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const snapshot = await db
      .collection('room_audit')
      .where('actorUid', '==', uid)
      .limit(limit)
      .get();

    if (snapshot.empty) return 0;

    const pseudonym = this.deletedUserReference(uid);
    const batch = db.batch();

    snapshot.docs.forEach((documentSnapshot) => {
      const data = documentSnapshot.data() ?? {};
      const patch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
        actorUid: pseudonym,
        actorIdentityState: 'pseudonymized_after_account_deletion',
        actorDeletedAt: FieldValue.serverTimestamp(),
      };

      if (data['subjectUid'] === uid) {
        patch['subjectUid'] = pseudonym;
        patch['subjectIdentityState'] =
          'pseudonymized_after_account_deletion';
      }

      batch.update(documentSnapshot.ref, patch);
    });

    await batch.commit();
    return snapshot.size;
  }

  async clearPrivateRoomReferences(uid: string): Promise<number> {
    const userRef = db.collection('users').doc(uid);
    const snapshot = await userRef.get();

    if (!snapshot.exists) return 0;

    const data = snapshot.data() ?? {};
    if (!Object.prototype.hasOwnProperty.call(data, 'roomIds')) return 0;

    await userRef.set(
      {
        roomIds: FieldValue.delete(),
      },
      { merge: true }
    );

    return 1;
  }

  async unlinkOwnedFriendshipsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const snapshot = await db
      .collection('users')
      .doc(uid)
      .collection('friends')
      .limit(limit)
      .get();

    const refs: FirebaseFirestore.DocumentReference[] = [];

    for (const friendSnapshot of snapshot.docs) {
      const data = friendSnapshot.data() as { friendUid?: unknown };
      const friendUid = String(data.friendUid ?? friendSnapshot.id).trim();

      refs.push(friendSnapshot.ref);

      if (friendUid && friendUid !== uid) {
        refs.push(
          db.collection('users').doc(friendUid).collection('friends').doc(uid)
        );
      }
    }

    await this.deleteDocumentRefs(refs);
    return snapshot.size;
  }

  async deleteInboundFriendshipReferencesPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const snapshot = await db
      .collectionGroup('friends')
      .where('friendUid', '==', uid)
      .limit(limit)
      .get();

    await this.deleteDocumentRefs(snapshot.docs.map((doc) => doc.ref));
    return snapshot.size;
  }

  async inspectBlockReferences(
    uid: string
  ): Promise<AccountBlockReferenceSummary> {
    const [owned, inbound] = await Promise.all([
      db
        .collection('users')
        .doc(uid)
        .collection('blocks')
        .limit(1)
        .get(),
      db.collectionGroup('blocks').where('uid', '==', uid).limit(1).get(),
    ]);

    return {
      owned: owned.size,
      inbound: inbound.size,
    };
  }

  private async processRoomReferences(
    uid: string,
    roomIds: readonly string[],
    scannedOverride?: number
  ): Promise<RoomParticipationPageSummary> {
    const uniqueRoomIds = [...new Set(roomIds)];
    let processed = 0;
    let blockingOwners = 0;

    for (const roomId of uniqueRoomIds) {
      const result = await this.unlinkRoomReference(uid, roomId);
      processed += result.processed;
      blockingOwners += result.blockingOwners;
    }

    return {
      scanned: scannedOverride ?? roomIds.length,
      processed,
      blockingOwners,
    };
  }

  private async unlinkRoomReference(
    uid: string,
    roomId: string
  ): Promise<RoomReferenceMutationResult> {
    return db.runTransaction(async (transaction) => {
      const roomRef = db.collection('rooms').doc(roomId);
      const memberRef = roomRef.collection('members').doc(uid);
      const participantRef = roomRef.collection('participants').doc(uid);
      const auditRef = db
        .collection('room_audit')
        .doc(`account-delete-${this.deletedUserKey(uid)}-${roomId}`);
      const [roomSnapshot, memberSnapshot, participantSnapshot] =
        await Promise.all([
          transaction.get(roomRef),
          transaction.get(memberRef),
          transaction.get(participantRef),
        ]);

      if (!roomSnapshot.exists) {
        if (memberSnapshot.exists) transaction.delete(memberRef);
        if (participantSnapshot.exists) transaction.delete(participantRef);

        return {
          processed: memberSnapshot.exists || participantSnapshot.exists ? 1 : 0,
          blockingOwners: 0,
        };
      }

      const room = roomSnapshot.data() ?? {};
      const createdBy = String(room['createdBy'] ?? '').trim();
      const status = String(room['status'] ?? '').trim().toLowerCase();
      const isOwner = createdBy === uid;

      if (isOwner && !TERMINAL_ROOM_STATUSES.has(status)) {
        return { processed: 0, blockingOwners: 1 };
      }

      const participants = Array.isArray(room['participants'])
        ? room['participants'].filter(
          (participant): participant is string =>
            typeof participant === 'string'
        )
        : [];
      const nextParticipants = participants.filter(
        (participantUid) => participantUid !== uid
      );
      const participantChanged = nextParticipants.length !== participants.length;
      const hasChildReference = memberSnapshot.exists || participantSnapshot.exists;
      const shouldAnonymizeOwner = isOwner && TERMINAL_ROOM_STATUSES.has(status);
      const changed =
        participantChanged || hasChildReference || shouldAnonymizeOwner;

      if (!changed) {
        return { processed: 0, blockingOwners: 0 };
      }

      const now = FieldValue.serverTimestamp();
      const patch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
        updatedAt: now,
        lastActivity: now,
      };

      if (participantChanged) {
        patch['participants'] = nextParticipants;
        patch['memberCount'] = nextParticipants.length;
      }

      if (shouldAnonymizeOwner) {
        const pseudonym = this.deletedUserReference(uid);
        patch['createdBy'] = pseudonym;
        patch['ownerIdentityState'] =
          'pseudonymized_after_account_deletion';
        patch['ownerDeletedAt'] = now;

        if (room['closedBy'] === uid) {
          patch['closedBy'] = pseudonym;
        }
      }

      transaction.update(roomRef, patch);
      if (memberSnapshot.exists) transaction.delete(memberRef);
      if (participantSnapshot.exists) transaction.delete(participantRef);
      transaction.set(
        auditRef,
        {
          action: shouldAnonymizeOwner
            ? 'account_deletion_closed_room_owner_pseudonymized'
            : 'account_deletion_room_participation_unlinked',
          roomId,
          actorUid: 'system',
          subjectReference: this.deletedUserReference(uid),
          previousMembershipRole:
            memberSnapshot.data()?.['membershipRole'] ?? null,
          previousRoomStatus: status || null,
          createdAt: now,
          source: 'scheduled-account-purge',
        },
        { merge: true }
      );

      return { processed: 1, blockingOwners: 0 };
    });
  }

  private async resolveOwnerSlot(
    uid: string
  ): Promise<RoomReferenceMutationResult> {
    const slotRef = db.collection('room_owner_slots').doc(uid);
    const slotSnapshot = await slotRef.get();

    if (!slotSnapshot.exists) {
      return { processed: 0, blockingOwners: 0 };
    }

    const slot = slotSnapshot.data() ?? {};
    const active = slot['active'] === true;
    const roomId = String(slot['roomId'] ?? '').trim();

    if (!active || !roomId) {
      await slotRef.delete();
      return { processed: 1, blockingOwners: 0 };
    }

    const roomSnapshot = await db.collection('rooms').doc(roomId).get();
    const room = roomSnapshot.data() ?? {};
    const status = String(room['status'] ?? '').trim().toLowerCase();
    const stillOwned = roomSnapshot.exists && room['createdBy'] === uid;

    if (stillOwned && !TERMINAL_ROOM_STATUSES.has(status)) {
      return { processed: 0, blockingOwners: 1 };
    }

    await slotRef.delete();
    return { processed: 1, blockingOwners: 0 };
  }

  private async unlinkCommunityMembership(
    uid: string,
    communityId: string
  ): Promise<void> {
    await db.runTransaction(async (transaction) => {
      const communityRef = db.collection('communities').doc(communityId);
      const membershipRef = communityRef.collection('members').doc(uid);
      const discoveryRef = db
        .collection('community_discovery_index')
        .doc(communityId);
      const userIndexRef = db
        .collection('community_user_index')
        .doc(uid)
        .collection('items')
        .doc(communityId);
      const auditRef = db
        .collection('community_membership_audit')
        .doc(`account-delete-${uid}-${communityId}`);

      const [membershipSnapshot, communitySnapshot, discoverySnapshot] =
        await Promise.all([
          transaction.get(membershipRef),
          transaction.get(communityRef),
          transaction.get(discoveryRef),
        ]);

      if (!membershipSnapshot.exists) {
        transaction.delete(userIndexRef);
        return;
      }

      const membership = membershipSnapshot.data() ?? {};
      const role = String(membership['role'] ?? '').trim();
      const status = String(membership['status'] ?? '').trim();

      if (role === 'owner') {
        throw new Error('owner-transfer-or-community-archive-required');
      }

      const now = FieldValue.serverTimestamp();
      transaction.delete(membershipRef);
      transaction.delete(userIndexRef);

      if (status === 'active' && communitySnapshot.exists) {
        const nextCount = this.nextCommunityMemberCount(
          communitySnapshot.data()
        );
        transaction.update(communityRef, {
          'metrics.memberCount': nextCount,
          updatedAt: now,
        });

        if (discoverySnapshot.exists) {
          transaction.update(discoveryRef, {
            'metrics.memberCount': nextCount,
            updatedAt: now,
          });
        }
      }

      transaction.set(
        auditRef,
        {
          action: 'account_deletion_membership_unlinked',
          communityId,
          actorUid: 'system',
          subjectUid: uid,
          previousRole: role || null,
          previousStatus: status || null,
          nextStatus: 'deleted_with_account',
          createdAt: now,
          source: 'scheduled-account-purge',
        },
        { merge: true }
      );
    });
  }

  private resolveCommunityMembershipPath(path: string, uid: string): string {
    const segments = String(path ?? '').split('/');
    const valid =
      segments.length === 4 &&
      segments[0] === 'communities' &&
      segments[2] === 'members' &&
      segments[3] === uid &&
      /^[A-Za-z0-9:_-]{1,128}$/.test(segments[1] ?? '');

    if (!valid) {
      throw new Error('unexpected-community-membership-path');
    }

    return segments[1]!;
  }

  private resolveRoomReferencePath(
    path: string,
    uid: string,
    collectionName: 'members' | 'participants'
  ): string {
    const segments = String(path ?? '').split('/');
    const valid =
      segments.length === 4 &&
      segments[0] === 'rooms' &&
      segments[2] === collectionName &&
      segments[3] === uid &&
      /^[A-Za-z0-9:_-]{1,128}$/.test(segments[1] ?? '');

    if (!valid) {
      throw new Error(`unexpected-room-${collectionName}-path`);
    }

    return segments[1]!;
  }

  private nextCommunityMemberCount(
    rawCommunity: FirebaseFirestore.DocumentData | undefined
  ): number {
    const metrics = (rawCommunity?.['metrics'] ?? {}) as Record<string, unknown>;
    const current = Math.trunc(Number(metrics['memberCount']));
    return Number.isFinite(current) ? Math.max(current - 1, 0) : 0;
  }

  private deletedUserKey(uid: string): string {
    return createHash('sha256').update(uid).digest('hex').slice(0, 24);
  }

  private deletedUserReference(uid: string): string {
    return `deleted:${this.deletedUserKey(uid)}`;
  }

  private async deleteDocumentRefs(
    refs: readonly FirebaseFirestore.DocumentReference[]
  ): Promise<void> {
    const byPath = new Map<string, FirebaseFirestore.DocumentReference>();
    refs.forEach((ref) => byPath.set(ref.path, ref));
    const uniqueRefs = [...byPath.values()];

    for (let offset = 0; offset < uniqueRefs.length; offset += MAX_BATCH_WRITES) {
      const chunk = uniqueRefs.slice(offset, offset + MAX_BATCH_WRITES);
      const batch = db.batch();

      chunk.forEach((ref) => batch.delete(ref));
      await batch.commit();
    }
  }
}
