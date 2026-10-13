/**
 * Emulator-only durable attempt journal. Never stores message text, message IDs,
 * participant IDs, checkpoint payloads, or raw exception messages.
 * A stale RUNNING record means interrupted/unknown, not a completed backfill.
 */
import { randomUUID } from 'node:crypto';
import { db, FieldValue } from '../../../firebaseApp';

export type DirectUnreadBackfillStage = 'PREFLIGHT' | 'RECONCILE' | 'VERIFY';

function ensureEmulator(): void {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const projects = [
    process.env.GCLOUD_PROJECT, process.env.GOOGLE_CLOUD_PROJECT, process.env.GCP_PROJECT,
  ].filter(Boolean);
  if (!host || !/^(127\.0\.0\.1|localhost):[0-9]{1,5}$/.test(host) ||
      projects.length === 0 || projects.some((id) => id !== 'demo-entretenimento') ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('Unread journal requires local demo emulator');
  }
}

export async function startDirectUnreadEmulatorJournal(chatId: string) {
  ensureEmulator();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(chatId)) throw new Error('Invalid journal scope');
  const runId = randomUUID();
  const ref = db.collection('direct_chat_unread_backfill_emulator_runs').doc(runId);
  await ref.create({
    chatId, status: 'RUNNING', stage: 'PREFLIGHT', version: 1,
    completedMessagesRecorded: 0, transactionAttemptsRecorded: 0,
    committedProjectionCheckpointWritesRecorded: 0,
    startedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  });
  let writes = 1;
  return {
    runId,
    get writes() { return writes; },
    async progress(completedMessages: number, transactionAttempts: number,
      committedProjectionCheckpointWrites: number) {
      await ref.update({
        stage: 'RECONCILE', completedMessagesRecorded: completedMessages,
        transactionAttemptsRecorded: transactionAttempts,
        committedProjectionCheckpointWritesRecorded: committedProjectionCheckpointWrites,
        updatedAt: FieldValue.serverTimestamp(),
      });
      writes += 1;
    },
    async succeeded(completedMessages: number, durationMs: number) {
      await ref.update({
        status: 'SUCCEEDED', stage: 'VERIFY',
        completedMessagesRecorded: completedMessages, durationMs,
        finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      writes += 1;
    },
    async failed(stage: DirectUnreadBackfillStage) {
      await ref.update({
        status: 'FAILED', stage, failureCode: 'BACKFILL_ABORTED',
        finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      });
      writes += 1;
    },
  };
}
