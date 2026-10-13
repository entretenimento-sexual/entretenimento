/**
 * Initial unread backfill restricted to the local Firestore Emulator.
 * Only chats with NO projections can be initialized. Existing partial
 * projections are deliberately rejected; reconciliation of those requires
 * a separate recovery protocol.
 */
import { db } from '../../../firebaseApp';
import { auditDirectUnreadConversation } from './direct-unread-backfill.audit';
import { reconcileDirectUnreadMessage } from './sync-direct-unread-projection.trigger';

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
  if (!before.complete || before.summary.NO_PROJECTION !== 2) {
    throw new Error('Unread backfill requires complete chat and two missing projections');
  }
  const documents = await db.collection('chats').doc(chatId).collection('messages')
    .orderBy('__name__').limit(101).get();
  if (documents.size > 100 || documents.size !== before.scanned) {
    throw new Error('Unread backfill preflight changed');
  }
  // Each message reconciliation is a Firestore transaction with per-message checkpoints.
  // Failures stop processing. Retry is safe at the per-message level, but this
  // initial-only command intentionally refuses partial recovery.
  for (const doc of documents.docs) {
    await reconcileDirectUnreadMessage(chatId, doc.id);
  }
  const after = await auditDirectUnreadConversation(chatId);
  if (!after.complete || after.summary.MATCH !== 2) {
    throw new Error('Unread backfill requires manual review after reconciliation');
  }
  return {
    mode: 'EMULATOR_WRITE', chatId,
    processedMessages: documents.size, before: before.summary, after: after.summary,
  };
}
