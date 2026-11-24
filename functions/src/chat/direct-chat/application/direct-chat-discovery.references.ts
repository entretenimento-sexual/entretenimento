import type { Transaction } from 'firebase-admin/firestore';
import { db } from '../../../firebaseApp';
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
    transaction.set(
      db.doc(`direct_chat_discovery/${ownerUid}/chats/${chatId}`),
      { version: 1, chatId }
    );
  }
}
