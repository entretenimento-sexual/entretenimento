/**
 * Bounded unread backfill restricted to the local Firestore Emulator.
 * Existing checkpoints can be resumed only after integrity verification.
 * Production use, empty chats and histories above 100 messages are blocked.
 */
import { db } from '../../../firebaseApp';
import { auditDirectUnreadConversation } from './direct-unread-backfill.audit';
import { reconcileDirectUnreadMessage } from './sync-direct-unread-projection.trigger';
import { isDirectMessageUnread, type DirectUnreadMessage } from '../domain/direct-unread-projection.policy';
import { estimateDirectUnreadBackfillBudget } from '../domain/direct-unread-backfill-budget.policy';

export async function initializeDirectUnreadOnEmulator(chatId: string) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const projects = [
    process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT, process.env.GCP_PROJECT,
  ].filter(Boolean);
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host) ||
      projects.length === 0 || projects.some((id) => id !== 'demo-entretenimento') ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Unread backfill requires isolated local demo emulator');
  }
  const before = await auditDirectUnreadConversation(chatId);
  if (!before.complete) {
    throw new Error('Unread backfill requires a complete bounded chat');
  }
  const documents = await db.collection('chats').doc(chatId).collection('messages')
    .orderBy('__name__').limit(101).get();
  if (documents.size > 100 || documents.size !== before.scanned) {
    throw new Error('Unread backfill preflight changed');
  }
  const budget = estimateDirectUnreadBackfillBudget(documents.size);
  // Every recorded contribution must be represented by a checkpoint on
  // BOTH sides. Otherwise a retry could silently double-count older writes.
  const chat = await db.collection('chats').doc(chatId).get();
  const participants = chat.data()?.participants as string[];
  if (!Array.isArray(participants) || participants.length !== 2) {
    throw new Error('Invalid unread backfill participants');
  }
  const projections = participants.map((uid) => db.collection('direct_chat_unread_projections')
    .doc(uid).collection('chats').doc(chatId));
  const currentProjections = await Promise.all(projections.map((ref) => ref.get()));
  const checkpoints = await Promise.all(projections.map((ref) =>
    ref.collection('messages').limit(101).get()));
  for (let index = 0; index < participants.length; index += 1) {
    const projection = currentProjections[index];
    const checkpoint = checkpoints[index];
    if (checkpoint.size > 100 ||
        (!projection.exists && checkpoint.size > 0)) {
      throw new Error('Invalid partial unread backfill state');
    }
    const total = checkpoint.docs.reduce((count, item) => {
      const data = item.data();
      const status = data.status;
      const senderUid = data.senderUid;
      if (!documents.docs.some((doc) => doc.id === item.id) ||
          !participants.includes(senderUid) ||
          !['sent', 'delivered', 'read'].includes(status)) {
        throw new Error('Unrecognized unread backfill checkpoint');
      }
      const message: DirectUnreadMessage = {
        messageId: item.id, senderUid, status, deleted: data.deleted === true,
      };
      return count + Number(isDirectMessageUnread(message, participants[index]));
    }, 0);
    const stored = projection.data()?.unreadCount ?? 0;
    if (!Number.isSafeInteger(stored) || total !== stored) {
      throw new Error('Unread checkpoint total mismatch');
    }
  }
  const checkpointIds = checkpoints.map((snapshot) =>
    new Set(snapshot.docs.map((doc) => doc.id)));
  for (const doc of documents.docs) {
    if (checkpointIds[0].has(doc.id) !== checkpointIds[1].has(doc.id)) {
      throw new Error('Asymmetric unread backfill checkpoints');
    }
  }
  // A transaction validates the whole message set before writing each checkpoint.
  // Do not repeat the same collection scan outside that transaction.
  const expectedMessageIds = documents.docs.map((message) => message.id);
  for (const messageId of expectedMessageIds) {
    await reconcileDirectUnreadMessage(chatId, messageId, participants, expectedMessageIds);
  }
  const after = await auditDirectUnreadConversation(chatId);
  if (!after.complete || after.summary.MATCH !== 2) {
    throw new Error('Unread backfill requires manual review after reconciliation');
  }
  return {
    mode: 'EMULATOR_WRITE', chatId,
    processedMessages: documents.size, before: before.summary, after: after.summary,
    budget,
  };
}
