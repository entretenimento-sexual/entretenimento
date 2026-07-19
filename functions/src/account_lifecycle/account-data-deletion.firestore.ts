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
