import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import {
  initializeDirectUnreadForEmulatorTest, initializeDirectUnreadOnEmulator,
} from './direct-unread-backfill.emulator';
import {
  startDirectUnreadEmulatorJournal, inspectDirectUnreadEmulatorJournal,
  listDirectUnreadEmulatorJournals,
  purgeDirectUnreadEmulatorJournal,
} from './direct-unread-backfill.journal.emulator';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('durable unread backfill journal — isolated emulator', () => {
  it('leaves an unfinished attempt RUNNING until explicitly terminated', async () => {
    const chatId = `unread-abandoned-${randomUUID()}`;
    const journal = db.collection('direct_chat_unread_backfill_emulator_runs');
    const started = await startDirectUnreadEmulatorJournal(chatId);
    try {
      const snapshot = await journal.doc(started.runId).get();
      assert.equal(snapshot.data()?.status, 'RUNNING');
      assert.equal(snapshot.data()?.completedMessagesRecorded, 0);
      assert.equal(snapshot.data()?.finishedAt, undefined);
    } finally {
      await journal.doc(started.runId).delete();
    }
  });

  it('flags stale RUNNING without deleting it, then purges an expired terminal record', async () => {
    const journal = db.collection('direct_chat_unread_backfill_emulator_runs');
    const started = await startDirectUnreadEmulatorJournal(`unread-retention-${randomUUID()}`);
    const ref = journal.doc(started.runId);
    const old = Timestamp.fromMillis(Date.now() - 31 * 24 * 60 * 60 * 1000);
    try {
      await ref.update({ updatedAt: old });
      const stale = await inspectDirectUnreadEmulatorJournal(started.runId);
      assert.equal(stale.classification, 'RUNNING_STALE_UNKNOWN');
      assert.equal(stale.eligibleForPurge, false);
      const listing = await listDirectUnreadEmulatorJournals(
        (await ref.get()).data()?.chatId as string
      );
      assert.equal(listing.mutationCount, 0);
      assert.equal(listing.records.find((record) => record.runId === started.runId)?.classification,
        'RUNNING_STALE_UNKNOWN');
      await assert.rejects(purgeDirectUnreadEmulatorJournal(
        started.runId, 'CONFIRM_TERMINAL_JOURNAL_PURGE'
      ));
      assert.equal((await ref.get()).exists, true);
      await ref.update({ status: 'FAILED', updatedAt: old, finishedAt: old });
      const expired = await inspectDirectUnreadEmulatorJournal(started.runId);
      assert.equal(expired.classification, 'FAILED');
      assert.equal(expired.eligibleForPurge, true);
      await assert.rejects(purgeDirectUnreadEmulatorJournal(started.runId, 'WRONG'));
      const purged = await purgeDirectUnreadEmulatorJournal(
        started.runId, 'CONFIRM_TERMINAL_JOURNAL_PURGE'
      );
      assert.equal(purged.mutationCount, 1);
      assert.equal((await ref.get()).exists, false);
    } finally {
      await ref.delete();
    }
  });

  it('protects recently finished journals and incomplete timestamps', async () => {
    const started = await startDirectUnreadEmulatorJournal(`unread-recent-${randomUUID()}`);
    const ref = db.collection('direct_chat_unread_backfill_emulator_runs').doc(started.runId);
    try {
      await started.succeeded(1, 12);
      assert.equal((await inspectDirectUnreadEmulatorJournal(started.runId)).eligibleForPurge, false);
      await assert.rejects(purgeDirectUnreadEmulatorJournal(
        started.runId, 'CONFIRM_TERMINAL_JOURNAL_PURGE'
      ));
      await ref.update({ finishedAt: null });
      assert.equal((await inspectDirectUnreadEmulatorJournal(started.runId)).classification,
        'INVALID');
      await assert.rejects(purgeDirectUnreadEmulatorJournal(
        started.runId, 'CONFIRM_TERMINAL_JOURNAL_PURGE'
      ));
    } finally {
      await ref.delete();
    }
  });

  it('records an interruption and permits checkpoint-safe recovery', async () => {
    const chatId = `unread-journal-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const journal = db.collection('direct_chat_unread_backfill_emulator_runs');
    const projections = ['sender', 'recipient'].map((uid) =>
      db.collection('direct_chat_unread_projections').doc(uid)
        .collection('chats').doc(chatId));
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      const batch = db.batch();
      for (let index = 0; index < 12; index += 1) {
        batch.set(chat.collection('messages').doc(String(index).padStart(3, '0')), {
          senderId: 'sender', status: 'sent', content: 'never-copy-this-private-content',
        });
      }
      await batch.commit();
      await assert.rejects(initializeDirectUnreadForEmulatorTest(chatId, async (completed) => {
        if (completed === 10) throw new Error('never-copy-this-exception-message');
      }));
      let records = await journal.where('chatId', '==', chatId).get();
      assert.equal(records.size, 1);
      assert.equal(records.docs[0].data().status, 'FAILED');
      assert.equal(records.docs[0].data().stage, 'RECONCILE');
      assert.equal(records.docs[0].data().completedMessagesRecorded, 10);
      assert.equal((await projections[1].get()).data()?.unreadCount, 10);
      assert.ok(!JSON.stringify(records.docs[0].data()).includes('never-copy-this'));
      const recovered = await initializeDirectUnreadOnEmulator(chatId);
      assert.equal(recovered.after.MATCH, 2);
      assert.equal(recovered.observations.journalWrites, 4);
      assert.equal((await projections[1].get()).data()?.unreadCount, 12);
      records = await journal.where('chatId', '==', chatId).get();
      assert.equal(records.size, 2);
      const complete = records.docs.find((doc) => doc.id === recovered.runId);
      assert.equal(complete?.data().status, 'SUCCEEDED');
      assert.equal(complete?.data().completedMessagesRecorded, 12);
      assert.equal(complete?.data().committedProjectionCheckpointWritesRecorded, 8);
      assert.ok(!JSON.stringify(complete?.data()).includes('never-copy-this'));
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all(projections.map((ref) => db.recursiveDelete(ref)));
      const records = await journal.where('chatId', '==', chatId).get();
      await Promise.all(records.docs.map((doc) => doc.ref.delete()));
    }
  });
});
