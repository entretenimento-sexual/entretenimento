/**
 * Emulator-only durable attempt journal. Never stores message text, message IDs,
 * participant IDs, checkpoint payloads, or raw exception messages.
 * A stale RUNNING record means interrupted/unknown, not a completed backfill.
 */
import { randomUUID } from 'node:crypto';
import { db, FieldValue } from '../../../firebaseApp';
import { classifyDirectUnreadJournal } from '../domain/direct-unread-backfill-journal.policy';

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

function journalRef(runId: string) {
  ensureEmulator();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    throw new Error('Invalid unread journal run ID');
  }
  return db.collection('direct_chat_unread_backfill_emulator_runs').doc(runId);
}

function journalDecision(data: FirebaseFirestore.DocumentData | undefined, nowMs: number) {
  const updated = data?.updatedAt as FirebaseFirestore.Timestamp | undefined;
  const finished = data?.finishedAt as FirebaseFirestore.Timestamp | undefined;
  return classifyDirectUnreadJournal(
    data?.status, updated?.toMillis?.() ?? null, finished?.toMillis?.() ?? null, nowMs
  );
}

/** Bounded discovery for runs whose process terminated before reporting runId. */
export async function listDirectUnreadEmulatorJournals(chatId: string) {
  ensureEmulator();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(chatId)) throw new Error('Invalid journal scope');
  const snapshot = await db.collection('direct_chat_unread_backfill_emulator_runs')
    .where('chatId', '==', chatId).limit(21).get();
  const records = snapshot.docs.slice(0, 20).map((doc) => {
    const decision = journalDecision(doc.data(), Date.now());
    return {
      runId: doc.id, classification: decision.classification,
      eligibleForPurge: decision.eligibleForPurge,
    };
  });
  return {
    mode: 'DRY_RUN' as const, chatId, mutationCount: 0,
    records, truncated: snapshot.size > 20,
  };
}

/** Read-only single-run inspection, with no private messages or exception payloads. */
export async function inspectDirectUnreadEmulatorJournal(runId: string) {
  const snapshot = await journalRef(runId).get();
  if (!snapshot.exists) throw new Error('Unread journal run not found');
  const data = snapshot.data();
  const decision = journalDecision(data, Date.now());
  return {
    mode: 'DRY_RUN' as const, runId, mutationCount: 0,
    classification: decision.classification,
    eligibleForPurge: decision.eligibleForPurge,
    completedMessagesRecorded: data?.completedMessagesRecorded ?? null,
    transactionAttemptsRecorded: data?.transactionAttemptsRecorded ?? null,
    stage: ['PREFLIGHT', 'RECONCILE', 'VERIFY'].includes(data?.stage) ? data?.stage : 'UNKNOWN',
  };
}

/** One explicit, transactional purge; never removes RUNNING or recent attempts. */
export async function purgeDirectUnreadEmulatorJournal(runId: string, confirmation: string) {
  if (confirmation !== 'CONFIRM_TERMINAL_JOURNAL_PURGE') {
    throw new Error('Explicit journal purge confirmation required');
  }
  const ref = journalRef(runId);
  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists || !journalDecision(snapshot.data(), Date.now()).eligibleForPurge) {
      throw new Error('Journal is active, unknown, malformed, or inside retention window');
    }
    tx.delete(ref);
  }, { maxAttempts: 3 });
  return { mode: 'EMULATOR_JOURNAL_PURGE' as const, runId, mutationCount: 1 };
}
