import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { auditDirectUnreadPage, auditDirectUnreadConsistent } from './direct-unread-backfill.audit';

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

  it('detects divergence and rejects nonparticipant scans', async () => {
    await projection.update({ unreadCount: 7 });
    const report = await auditDirectUnreadPage(chatId, 'recipient', null, 100);
    assert.equal(report.comparison, 'MISMATCH');
    await assert.rejects(auditDirectUnreadPage(chatId, 'outsider'));
  });
});
