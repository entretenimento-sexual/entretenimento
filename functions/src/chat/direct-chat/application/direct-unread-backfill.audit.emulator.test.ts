import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import {
  auditDirectUnreadPage, auditDirectUnreadConsistent, auditDirectUnreadConversation,
} from './direct-unread-backfill.audit';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('unread projection audit — read only', () => {
  const chatId = `unread-audit-${randomUUID()}`;
  const chat = db.collection('chats').doc(chatId);
  const projection = db.collection('direct_chat_unread_projections')
    .doc('recipient').collection('chats').doc(chatId);

  before(async () => {
    await chat.set({ participants: ['sender', 'recipient'] });
    await Promise.all([
      chat.collection('messages').doc('001').set({ senderId: 'sender', status: 'sent' }),
      chat.collection('messages').doc('002').set({ senderId: 'sender', status: 'delivered' }),
      chat.collection('messages').doc('003').set({ senderId: 'sender', status: 'read' }),
      chat.collection('messages').doc('004').set({ senderId: 'recipient', status: 'sent' }),
    ]);
    await projection.set({ unreadCount: 2, version: 1 });
  });

  after(async () => {
    await Promise.all([db.recursiveDelete(chat), db.recursiveDelete(projection)]);
  });

  it('audits bounded pages without writes or leaking message content', async () => {
    const first = await auditDirectUnreadPage(chatId, 'recipient', null, 2);
    assert.equal(first.comparison, 'INCOMPLETE');
    assert.equal(first.unreadInPage, 2);
    assert.equal(first.scanned, 2);
    assert.ok(first.nextCursor);

    const second = await auditDirectUnreadPage(
      chatId, 'recipient', first.nextCursor, 2, first.scanned, first.unreadInPage
    );
    assert.equal(second.complete, true);
    assert.equal(second.comparison, 'INCONCLUSIVE');
    assert.equal(second.consistency, 'UNVERIFIED_MULTI_PAGE');
    assert.equal(second.scanned, 4);
    assert.equal(second.unreadInPage, 2);
    assert.equal((await projection.get()).data()?.unreadCount, 2);
    assert.equal((await projection.collection('messages').get()).size, 0);
  });

  it('compares message count and projection inside one read-only transaction', async () => {
    const before = await auditDirectUnreadConsistent(chatId, 'recipient');
    assert.equal(before.comparison, 'MATCH');
    assert.equal(before.unreadInPage, 2);
    await projection.update({ unreadCount: 9 });
    const after = await auditDirectUnreadConsistent(chatId, 'recipient');
    assert.equal(after.comparison, 'MISMATCH');
    assert.equal(after.storedUnreadCount, 9);
    await projection.update({ unreadCount: 2 });
    await assert.rejects(auditDirectUnreadConsistent(chatId, 'outsider'));
  });

  it('consolidates both participants in one read-only audit', async () => {
    const senderRef = db.collection('direct_chat_unread_projections')
      .doc('sender').collection('chats').doc(chatId);
    await senderRef.set({ unreadCount: 1, version: 1 });
    try {
      const report = await auditDirectUnreadConversation(chatId);
      assert.equal(report.summary.MATCH, 2);
      assert.equal(report.scanned, 4);
      assert.equal(report.mutationCount, 0);
      assert.equal(report.requiresReconciliation, false);
    } finally {
      await senderRef.delete();
    }
  });
  it('separates a missing projection from a participant-specific mismatch', async () => {
    const senderRef = db.collection('direct_chat_unread_projections')
      .doc('sender').collection('chats').doc(chatId);
    await projection.set({ unreadCount: 8, version: 1 });
    try {
      const report = await auditDirectUnreadConversation(chatId);
      assert.equal(report.summary.MISMATCH, 1);
      assert.equal(report.summary.NO_PROJECTION, 1);
      assert.equal(report.summary.MATCH, 0);
      assert.equal(report.requiresReconciliation, true);
      assert.equal((await senderRef.get()).exists, false);
      assert.equal((await projection.get()).data()?.unreadCount, 8);
    } finally {
      await projection.set({ unreadCount: 2, version: 1 });
    }
  });

  it('does not classify oversized conversations as definitive discrepancies', async () => {
    const bulk = chat.collection('messages');
    const batch = db.batch();
    for (let index = 0; index < 101; index += 1) {
      batch.set(bulk.doc(`oversized-${String(index).padStart(3, '0')}`), {
        senderId: 'sender', status: 'sent',
      });
    }
    await batch.commit();
    try {
      const report = await auditDirectUnreadConversation(chatId);
      assert.equal(report.complete, false);
      assert.equal(report.summary.INCONCLUSIVE, 2);
      assert.equal(report.summary.MISMATCH, 0);
      assert.equal(report.requiresReconciliation, false);
      assert.equal(report.mutationCount, 0);
    } finally {
      const cleanup = db.batch();
      for (let index = 0; index < 101; index += 1) {
        cleanup.delete(bulk.doc(`oversized-${String(index).padStart(3, '0')}`));
      }
      await cleanup.commit();
    }
  });

  it('does not mix receipt and projection states during a concurrent transaction', async () => {
    const messageRef = chat.collection('messages').doc('001');
    // The receipt and its projection are committed together in this scenario.
    // The audit may observe before or after, never half of the update.
    const [report] = await Promise.all([
      auditDirectUnreadConversation(chatId),
      db.runTransaction(async (tx) => {
        const current = await tx.get(messageRef);
        assert.equal(current.data()?.status, 'sent');
        tx.update(messageRef, { status: 'read' });
        tx.update(projection, { unreadCount: 1 });
      }),
    ]);
    const recipient = report.participants.find((row) => row.participantUid === 'recipient');
    assert.ok(recipient);
    assert.equal(recipient.comparison, 'MATCH');
    assert.ok(
      (recipient.actualUnreadCount === 2 && recipient.storedUnreadCount === 2) ||
      (recipient.actualUnreadCount === 1 && recipient.storedUnreadCount === 1)
    );
    await messageRef.update({ status: 'sent' });
    await projection.update({ unreadCount: 2 });
  });

  it('rejects invalid resume state and exceeding the global scan budget', async () => {
    await assert.rejects(auditDirectUnreadPage(chatId, 'recipient', '001', 2));
    await assert.rejects(auditDirectUnreadPage(chatId, 'recipient', null, 2, 2, 1));
    await assert.rejects(auditDirectUnreadPage(chatId, 'recipient', 'missing', 2, 2, 1));
    await assert.rejects(auditDirectUnreadPage(chatId, 'recipient', '002', 100, 950, 1));
  });

  it('confirms a single-query baseline before comparing counts', async () => {
    const result = await auditDirectUnreadPage(chatId, 'recipient', null, 100);
    assert.equal(result.consistency, 'SINGLE_QUERY');
    assert.equal(result.comparison, 'MATCH');
  });

  it('returns NO_PROJECTION with no writes for a missing projection', async () => {
    await projection.delete();
    const report = await auditDirectUnreadConsistent(chatId, 'recipient');
    assert.equal(report.comparison, 'NO_PROJECTION');
    assert.equal(report.storedUnreadCount, null);
    assert.equal((await projection.get()).exists, false);
    await projection.set({ unreadCount: 2, version: 1 });
  });

  it('marks histories over 100 messages inconclusive without changing projection', async () => {
    const bulk = chat.collection('messages');
    const batch = db.batch();
    for (let index = 0; index < 101; index += 1) {
      batch.set(bulk.doc(`extra-${String(index).padStart(3, '0')}`), {
        senderId: 'sender', status: 'sent',
      });
    }
    await batch.commit();
    const before = (await projection.get()).data();
    const report = await auditDirectUnreadConsistent(chatId, 'recipient');
    assert.equal(report.comparison, 'INCONCLUSIVE');
    assert.equal(report.complete, false);
    assert.equal(report.scanned, 100);
    assert.deepEqual((await projection.get()).data(), before);
    assert.equal((await projection.collection('messages').get()).size, 0);
    const cleanup = db.batch();
    for (let index = 0; index < 101; index += 1) {
      cleanup.delete(bulk.doc(`extra-${String(index).padStart(3, '0')}`));
    }
    await cleanup.commit();
  });

  it('detects divergence and rejects nonparticipant scans', async () => {
    await projection.update({ unreadCount: 7 });
    const report = await auditDirectUnreadPage(chatId, 'recipient', null, 100);
    assert.equal(report.comparison, 'MISMATCH');
    await assert.rejects(auditDirectUnreadPage(chatId, 'outsider'));
  });
});
