import type { Transaction } from 'firebase-admin/firestore';
import { db, FieldValue } from '../../../firebaseApp';
import { buildDirectChatPairIdentity } from '../domain/direct-chat.policy';

/**
 * Internal discovery candidates, NOT authorization and NOT a client index.
 * No content, peer identity, preview, unread count or access flag is copied.
 * Readers must independently validate the current canonical chat and access.
 */
export function stageDirectChatDiscoveryReferences(
  transaction: Transaction,
  participants: readonly [string, string],
  chatId: string
): void {
  const pair = buildDirectChatPairIdentity(participants[0], participants[1]);
  for (const ownerUid of pair.participants) {
    stageDirectChatDiscoveryInvalidation(transaction, ownerUid);
    transaction.set(
      db.doc(`direct_chat_discovery/${ownerUid}/chats/${chatId}`),
      { version: 1, chatId }
    );
  }
}

// Opaque owner-only invalidation, not an authorization grant.
// Merge is required: a replacing set can reset the transform base in the emulator.
// Keep the atomic server transform, never a client-side read/modify/write.
export function stageDirectChatDiscoveryInvalidation(
  transaction: Transaction, ownerUid: string
): void {
  transaction.set(db.doc(`direct_chat_discovery/${ownerUid}`), {
    version: 1, revision: FieldValue.increment(1),
  }, { merge: true });
}
