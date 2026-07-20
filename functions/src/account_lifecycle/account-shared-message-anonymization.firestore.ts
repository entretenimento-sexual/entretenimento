// functions/src/account_lifecycle/account-shared-message-anonymization.firestore.ts
// -----------------------------------------------------------------------------
// FIRESTORE ADAPTER FOR SHARED MESSAGE ANONYMIZATION
// -----------------------------------------------------------------------------
// Preserva o conteúdo compartilhado e substitui identificadores diretos por uma
// referência pseudônima determinística. O escopo aceito é chats e rooms.
// -----------------------------------------------------------------------------
import { createHash } from 'node:crypto';

import { db, FieldValue } from '../firebaseApp';
import { FirestoreAccountDataDeletionOrchestratorAdapter } from './account-owned-media-deletion.firestore';
import type {
  AccountSharedMessageAnonymizationAdapter,
  SharedMessageIdentityField,
} from './account-shared-message-anonymization.executor';

interface SharedMessageDocument {
  senderId?: unknown;
  senderUid?: unknown;
  recipientUid?: unknown;
  deletedBy?: unknown;
  nickname?: unknown;
  senderName?: unknown;
  senderNickname?: unknown;
  senderPhotoURL?: unknown;
  photoURL?: unknown;
  avatarUrl?: unknown;
  reactionsByUser?: unknown;
}

interface SharedContainerDocument {
  participants?: unknown;
  participantsKey?: unknown;
  lastMessage?: unknown;
  otherParticipantDetails?: unknown;
}

interface SharedMessagePath {
  containerCollection: 'chats' | 'rooms';
  containerId: string;
}

const DELETED_USER_LABEL = 'Usuário excluído';
const MAX_BATCH_WRITES = 450;

export class FirestoreAccountDataDeletionFullAdapter
  extends FirestoreAccountDataDeletionOrchestratorAdapter
  implements AccountSharedMessageAnonymizationAdapter
{
  async anonymizeMessageIdentityPage(
    uid: string,
    field: SharedMessageIdentityField,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collectionGroup('messages')
      .where(field, '==', safeUid)
      .limit(limit)
      .get();

    for (const messageSnapshot of snapshot.docs) {
      await this.anonymizeMessageIdentity(
        safeUid,
        field,
        messageSnapshot
      );
    }

    return snapshot.size;
  }

  async removeMessageReactionsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const reactionField = `reactionsByUser.${safeUid}`;
    const snapshot = await db
      .collectionGroup('messages')
      .where(reactionField, '!=', null)
      .limit(limit)
      .get();

    for (const messageSnapshot of snapshot.docs) {
      resolveSharedMessagePath(messageSnapshot.ref.path);
      await messageSnapshot.ref.update({
        [reactionField]: FieldValue.delete(),
        identityUpdatedAt: FieldValue.serverTimestamp(),
      });
    }

    return snapshot.size;
  }

  async anonymizeDirectChatsPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('chats')
      .where('participants', 'array-contains', safeUid)
      .limit(limit)
      .get();

    for (const chatSnapshot of snapshot.docs) {
      await db.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(chatSnapshot.ref);
        if (!currentSnapshot.exists) return;

        const chat = currentSnapshot.data() as SharedContainerDocument;
        const participants = normalizeParticipantList(chat.participants);
        if (!participants.includes(safeUid)) return;

        const pseudonym = deletedUserReference(safeUid);
        const nextParticipants = [...new Set(
          participants.map((participant) =>
            participant === safeUid ? pseudonym : participant
          )
        )].sort();
        const patch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
          participants: nextParticipants,
          participantsKey: nextParticipants.join('_'),
          deletedParticipantReferences: FieldValue.arrayUnion(pseudonym),
          [`participantIdentityStates.${pseudonym}`]:
            'pseudonymized_after_account_deletion',
          identityUpdatedAt: FieldValue.serverTimestamp(),
        };
        const lastMessage = normalizeRecord(chat.lastMessage);

        if (messageSenderMatches(lastMessage, safeUid)) {
          patch['lastMessage'] = anonymizeMessageRecord(
            lastMessage,
            safeUid,
            pseudonym
          );
        }

        const otherParticipant = normalizeRecord(chat.otherParticipantDetails);
        if (recordReferencesUid(otherParticipant, safeUid)) {
          patch['otherParticipantDetails'] = FieldValue.delete();
        }

        transaction.update(chatSnapshot.ref, patch);
      });
    }

    return snapshot.size;
  }

  async deleteDirectChatPairReferencesPage(
    uid: string,
    limit: number
  ): Promise<number> {
    const safeUid = requireUid(uid);
    const snapshot = await db
      .collection('direct_chat_pairs')
      .where('participants', 'array-contains', safeUid)
      .limit(limit)
      .get();

    await deleteDocumentRefs(snapshot.docs.map((document) => document.ref));
    return snapshot.size;
  }

  private async anonymizeMessageIdentity(
    uid: string,
    _field: SharedMessageIdentityField,
    messageSnapshot: FirebaseFirestore.QueryDocumentSnapshot
  ): Promise<void> {
    const path = resolveSharedMessagePath(messageSnapshot.ref.path);
    const containerRef = db
      .collection(path.containerCollection)
      .doc(path.containerId);

    await db.runTransaction(async (transaction) => {
      const [currentMessageSnapshot, containerSnapshot] = await Promise.all([
        transaction.get(messageSnapshot.ref),
        transaction.get(containerRef),
      ]);

      if (!currentMessageSnapshot.exists) return;

      const message = currentMessageSnapshot.data() as SharedMessageDocument;
      const pseudonym = deletedUserReference(uid);
      const patch = buildMessageIdentityPatch(message, uid, pseudonym);

      transaction.update(messageSnapshot.ref, patch);

      if (containerSnapshot.exists) {
        const container = containerSnapshot.data() as SharedContainerDocument;
        const lastMessage = normalizeRecord(container.lastMessage);

        if (messageSenderMatches(lastMessage, uid)) {
          transaction.update(containerRef, {
            lastMessage: anonymizeMessageRecord(
              lastMessage,
              uid,
              pseudonym
            ),
            identityUpdatedAt: FieldValue.serverTimestamp(),
          });
        }
      }
    });
  }
}

function buildMessageIdentityPatch(
  message: SharedMessageDocument,
  uid: string,
  pseudonym: string
): FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> {
  const patch: FirebaseFirestore.UpdateData<FirebaseFirestore.DocumentData> = {
    identityUpdatedAt: FieldValue.serverTimestamp(),
  };
  const senderMatches =
    normalizeId(message.senderId) === uid ||
    normalizeId(message.senderUid) === uid;

  if (normalizeId(message.senderId) === uid) {
    patch['senderId'] = pseudonym;
  }

  if (normalizeId(message.senderUid) === uid) {
    patch['senderUid'] = pseudonym;
  }

  if (normalizeId(message.recipientUid) === uid) {
    patch['recipientUid'] = pseudonym;
    patch['recipientIdentityState'] =
      'pseudonymized_after_account_deletion';
  }

  if (normalizeId(message.deletedBy) === uid) {
    patch['deletedBy'] = pseudonym;
  }

  if (senderMatches) {
    patch['senderIdentityState'] =
      'pseudonymized_after_account_deletion';
    patch['nickname'] = DELETED_USER_LABEL;

    if (Object.prototype.hasOwnProperty.call(message, 'senderName')) {
      patch['senderName'] = DELETED_USER_LABEL;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'senderNickname')) {
      patch['senderNickname'] = DELETED_USER_LABEL;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'senderPhotoURL')) {
      patch['senderPhotoURL'] = null;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'photoURL')) {
      patch['photoURL'] = null;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'avatarUrl')) {
      patch['avatarUrl'] = null;
    }
  }

  const reactions = normalizeRecord(message.reactionsByUser);
  if (Object.prototype.hasOwnProperty.call(reactions, uid)) {
    patch[`reactionsByUser.${uid}`] = FieldValue.delete();
  }

  return patch;
}

function anonymizeMessageRecord(
  raw: Record<string, unknown>,
  uid: string,
  pseudonym: string
): Record<string, unknown> {
  const next = { ...raw };

  if (normalizeId(next['senderId']) === uid) {
    next['senderId'] = pseudonym;
  }
  if (normalizeId(next['senderUid']) === uid) {
    next['senderUid'] = pseudonym;
  }
  if (
    normalizeId(next['senderId']) === pseudonym ||
    normalizeId(next['senderUid']) === pseudonym
  ) {
    next['nickname'] = DELETED_USER_LABEL;
    next['senderName'] = DELETED_USER_LABEL;
    next['senderNickname'] = DELETED_USER_LABEL;
    next['senderPhotoURL'] = null;
    next['photoURL'] = null;
    next['avatarUrl'] = null;
    next['senderIdentityState'] =
      'pseudonymized_after_account_deletion';
  }

  if (normalizeId(next['recipientUid']) === uid) {
    next['recipientUid'] = pseudonym;
    next['recipientIdentityState'] =
      'pseudonymized_after_account_deletion';
  }

  return next;
}

function messageSenderMatches(
  message: Record<string, unknown>,
  uid: string
): boolean {
  return (
    normalizeId(message['senderId']) === uid ||
    normalizeId(message['senderUid']) === uid
  );
}

function recordReferencesUid(
  record: Record<string, unknown>,
  uid: string
): boolean {
  return ['uid', 'id', 'userId', 'userUid'].some(
    (field) => normalizeId(record[field]) === uid
  );
}

function resolveSharedMessagePath(path: string): SharedMessagePath {
  const segments = String(path ?? '').split('/');
  const collectionName = segments[0];
  const valid =
    segments.length === 4 &&
    (collectionName === 'chats' || collectionName === 'rooms') &&
    segments[2] === 'messages' &&
    isSafeId(segments[1]) &&
    isSafeId(segments[3]);

  if (!valid) {
    throw new Error('unexpected-shared-message-path');
  }

  return {
    containerCollection: collectionName as 'chats' | 'rooms',
    containerId: segments[1]!,
  };
}

function normalizeParticipantList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((participant) => normalizeId(participant))
    .filter((participant): participant is string => participant !== null);
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function normalizeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return isSafeId(normalized) ? normalized : null;
}

function isSafeId(value: unknown): boolean {
  return /^[A-Za-z0-9:_-]{1,128}$/.test(String(value ?? ''));
}

function requireUid(value: unknown): string {
  const uid = normalizeId(value);
  if (!uid) throw new Error('UID inválido para anonimização de mensagens.');
  return uid;
}

function deletedUserReference(uid: string): string {
  const key = createHash('sha256').update(uid).digest('hex').slice(0, 24);
  return `deleted:${key}`;
}

async function deleteDocumentRefs(
  refs: readonly FirebaseFirestore.DocumentReference[]
): Promise<void> {
  for (let offset = 0; offset < refs.length; offset += MAX_BATCH_WRITES) {
    const batch = db.batch();
    const chunk = refs.slice(offset, offset + MAX_BATCH_WRITES);

    chunk.forEach((reference) => batch.delete(reference));
    await batch.commit();
  }
}
