import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { initializeDirectUnreadOnEmulator } from './direct-unread-backfill.emulator';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('direct unread backfill — measured emulator workloads', () => {
  for (const messageCount of [1, 50, 100]) {
    it(`measures ${messageCount} messages without exceeding the workload model`, async () => {
      const chatId = `unread-measured-${messageCount}-${randomUUID()}`;
      const chat = db.collection('chats').doc(chatId);
      const projections = ['sender', 'recipient'].map((uid) =>
        db.collection('direct_chat_unread_projections')
          .doc(uid).collection('chats').doc(chatId));
      try {
        await chat.set({ participants: ['sender', 'recipient'] });
        const batch = db.batch();
        for (let index = 0; index < messageCount; index += 1) {
          batch.set(chat.collection('messages').doc(String(index).padStart(3, '0')), {
            senderId: 'sender', status: 'sent',
          });
        }
        await batch.commit();
        const report = await initializeDirectUnreadOnEmulator(chatId);
        assert.equal(report.processedMessages, messageCount);
        assert.equal(report.after.MATCH, 2);
        assert.equal(report.observations.transactionAttempts, messageCount);
        assert.equal(report.observations.retryAttempts, 0);
        assert.equal(report.observations.committedDocumentWrites, messageCount * 4);
        assert.equal(report.observations.stagedDocumentWrites, messageCount * 4);
        assert.ok(report.observations.documentReadUnitsApprox > 0);
        assert.ok(report.observations.documentReadUnitsApprox <= report.budget.estimatedReadsNoRetry);
        assert.ok(report.observations.durationMs >= 0);
        assert.equal(report.observations.firestoreBillingVerified, false);
        assert.equal((await projections[1].get()).data()?.unreadCount, messageCount);
        if (messageCount === 50) {
          const repeated = await initializeDirectUnreadOnEmulator(chatId);
          assert.equal(repeated.after.MATCH, 2);
          assert.equal(repeated.observations.committedDocumentWrites, 0);
          assert.equal(repeated.observations.transactionAttempts, messageCount);
          assert.equal((await projections[1].get()).data()?.unreadCount, messageCount);
        }
      } finally {
        await db.recursiveDelete(chat);
        await Promise.all(projections.map((ref) => db.recursiveDelete(ref)));
      }
    });
  }
});
