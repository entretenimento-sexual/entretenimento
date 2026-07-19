// functions/src/account_lifecycle/account-data-deletion.firestore.ts
// -----------------------------------------------------------------------------
// FIRESTORE ADAPTER FOR ACCOUNT DATA DELETION
// -----------------------------------------------------------------------------
// Implementa somente domínios cujo contrato já está definido.
// Não toca em mensagens, mídias, denúncias, billing ou eventos de bloqueio.
// -----------------------------------------------------------------------------
import { db, FieldValue } from '../firebaseApp';
import type {
  AccountBlockReferenceSummary,
  AccountDataDeletionAdapter,
  FriendRequestDirection,
  NotificationReferenceDirection,
} from './account-data-deletion.executor';

const MAX_BATCH_WRITES = 450;
const COMMUNITY_MEMBER_ROLES = ['member', 'admin', 'moderator'] as const;

export class FirestoreAccountDataDeletionAdapter
  implements AccountDataDeletionAdapter
{
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

  private nextCommunityMemberCount(
    rawCommunity: FirebaseFirestore.DocumentData | undefined
  ): number {
    const metrics = (rawCommunity?.['metrics'] ?? {}) as Record<string, unknown>;
    const current = Math.trunc(Number(metrics['memberCount']));
    return Number.isFinite(current) ? Math.max(current - 1, 0) : 0;
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
