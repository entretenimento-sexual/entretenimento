import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { initializeDirectUnreadOnEmulator } from './direct-unread-backfill.emulator';
import { reconcileDirectUnreadMessage } from './sync-direct-unread-projection.trigger';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('unread initial backfill — local emulator only', () => {
  it('initializes two missing projections and refuses a second initialization', async () => {
    const chatId = `unread-initial-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const projections = ['sender', 'recipient'].map((uid) =>
      db.collection('direct_chat_unread_projections').doc(uid)
        .collection('chats').doc(chatId));
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      await chat.collection('messages').doc('first').set({
        senderId: 'sender', status: 'sent', content: 'private',
      });
      await chat.collection('messages').doc('second').set({
        senderId: 'recipient', status: 'read',
      });
      const result = await initializeDirectUnreadOnEmulator(chatId);
      assert.equal(result.processedMessages, 2);
      assert.equal(result.after.MATCH, 2);
      assert.equal((await projections[0].get()).data()?.unreadCount, 0);
      assert.equal((await projections[1].get()).data()?.unreadCount, 1);
      const retry = await initializeDirectUnreadOnEmulator(chatId);
      assert.equal(retry.after.MATCH, 2);
      assert.equal((await projections[1].get()).data()?.unreadCount, 1);
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all(projections.map((ref) => db.recursiveDelete(ref)));
    }
  });
  it('refuses corrupted checkpoint totals without mutating the projection', async () => {
    const chatId = `unread-corrupt-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const recipientRef = db.collection('direct_chat_unread_projections')
      .doc('recipient').collection('chats').doc(chatId);
    const senderRef = db.collection('direct_chat_unread_projections')
      .doc('sender').collection('chats').doc(chatId);
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      await chat.collection('messages').doc('first').set({
        senderId: 'sender', status: 'sent',
      });
      await recipientRef.set({ unreadCount: 99, version: 1 });
      await recipientRef.collection('messages').doc('first').set({
        messageId: 'first', senderUid: 'sender', status: 'sent',
      });
      await senderRef.set({ unreadCount: 0, version: 1 });
      await senderRef.collection('messages').doc('first').set({
        messageId: 'first', senderUid: 'sender', status: 'sent',
      });
      await assert.rejects(initializeDirectUnreadOnEmulator(chatId));
      assert.equal((await recipientRef.get()).data()?.unreadCount, 99);
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all([db.recursiveDelete(recipientRef), db.recursiveDelete(senderRef)]);
    }
  });

  it('resumes partial checkpoints after receipt and deletion changes', async () => {
    const chatId = `unread-resume-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const projections = ['sender', 'recipient'].map((uid) =>
      db.collection('direct_chat_unread_projections').doc(uid)
        .collection('chats').doc(chatId));
    const first = chat.collection('messages').doc('001');
    const second = chat.collection('messages').doc('002');
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      await first.set({ senderId: 'sender', status: 'sent' });
      await second.set({ senderId: 'sender', status: 'sent' });
      // Simulate interruption after the first transactional checkpoint.
      await reconcileDirectUnreadMessage(chatId, '001');
      assert.equal((await projections[1].get()).data()?.unreadCount, 1);
      await first.update({ status: 'read' });
      await second.update({ deleted: true });
      const resumed = await initializeDirectUnreadOnEmulator(chatId);
      assert.equal(resumed.after.MATCH, 2);
      assert.equal((await projections[1].get()).data()?.unreadCount, 0);
      const repeated = await initializeDirectUnreadOnEmulator(chatId);
      assert.equal(repeated.after.MATCH, 2);
      assert.equal((await projections[1].get()).data()?.unreadCount, 0);
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all(projections.map((ref) => db.recursiveDelete(ref)));
    }
  });

  it('converges when two emulator backfills run concurrently', async () => {
    const chatId = `unread-concurrent-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const projections = ['sender', 'recipient'].map((uid) =>
      db.collection('direct_chat_unread_projections').doc(uid)
        .collection('chats').doc(chatId));
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      await chat.collection('messages').doc('001').set({
        senderId: 'sender', status: 'sent',
      });
      await chat.collection('messages').doc('002').set({
        senderId: 'sender', status: 'delivered',
      });
      const results = await Promise.allSettled([
        initializeDirectUnreadOnEmulator(chatId),
        initializeDirectUnreadOnEmulator(chatId),
      ]);
      assert.ok(results.some((result) => result.status === 'fulfilled'));
      const verified = await initializeDirectUnreadOnEmulator(chatId);
      assert.equal(verified.after.MATCH, 2);
      assert.equal((await projections[1].get()).data()?.unreadCount, 2);
      assert.equal((await projections[1].collection('messages').get()).size, 2);
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all(projections.map((ref) => db.recursiveDelete(ref)));
    }
  });

  it('rejects a physically deleted message with an existing checkpoint', async () => {
    const chatId = `unread-deleted-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const projections = ['sender', 'recipient'].map((uid) =>
      db.collection('direct_chat_unread_projections').doc(uid)
        .collection('chats').doc(chatId));
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      const message = chat.collection('messages').doc('001');
      await message.set({ senderId: 'sender', status: 'sent' });
      await reconcileDirectUnreadMessage(chatId, '001');
      await message.delete();
      await assert.rejects(initializeDirectUnreadOnEmulator(chatId));
      assert.equal((await projections[1].get()).data()?.unreadCount, 1);
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all(projections.map((ref) => db.recursiveDelete(ref)));
    }
  });

  it('rejects changed chat participants before resuming existing checkpoints', async () => {
    const chatId = `unread-participants-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const projections = ['sender', 'recipient', 'replacement'].map((uid) =>
      db.collection('direct_chat_unread_projections').doc(uid)
        .collection('chats').doc(chatId));
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      await chat.collection('messages').doc('001').set({
        senderId: 'sender', status: 'sent',
      });
      await reconcileDirectUnreadMessage(chatId, '001');
      await chat.update({ participants: ['sender', 'replacement'] });
      await assert.rejects(initializeDirectUnreadOnEmulator(chatId));
      assert.equal((await projections[1].get()).data()?.unreadCount, 1);
      assert.equal((await projections[2].get()).exists, false);
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all(projections.map((ref) => db.recursiveDelete(ref)));
    }
  });

  it('refuses transactional reconciliation after participants change', async () => {
    const chatId = `unread-guard-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const projections = ['sender', 'recipient', 'replacement'].map((uid) =>
      db.collection('direct_chat_unread_projections').doc(uid)
        .collection('chats').doc(chatId));
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      await chat.collection('messages').doc('001').set({
        senderId: 'sender', status: 'sent',
      });
      await chat.update({ participants: ['sender', 'replacement'] });
      await assert.rejects(
        reconcileDirectUnreadMessage(chatId, '001', ['sender', 'recipient'])
      );
      assert.equal((await projections[2].get()).exists, false);
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all(projections.map((ref) => db.recursiveDelete(ref)));
    }
  });

  it('rejects inserted and deleted message sets inside the reconciliation transaction', async () => {
    const chatId = `unread-set-guard-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const projections = ['sender', 'recipient'].map((uid) =>
      db.collection('direct_chat_unread_projections').doc(uid)
        .collection('chats').doc(chatId));
    const first = chat.collection('messages').doc('001');
    const second = chat.collection('messages').doc('002');
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      await first.set({ senderId: 'sender', status: 'sent' });
      await second.set({ senderId: 'sender', status: 'delivered' });
      await assert.rejects(reconcileDirectUnreadMessage(
        chatId, '001', ['sender', 'recipient'], ['001']
      ));
      await first.delete();
      await assert.rejects(reconcileDirectUnreadMessage(
        chatId, '002', ['sender', 'recipient'], ['001', '002']
      ));
      assert.equal((await projections[1].get()).exists, false);
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all(projections.map((ref) => db.recursiveDelete(ref)));
    }
  });

  it('converges after an insertion races with a bounded reconciliation', async () => {
    const chatId = `unread-insert-race-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const recipient = db.collection('direct_chat_unread_projections')
      .doc('recipient').collection('chats').doc(chatId);
    const sender = db.collection('direct_chat_unread_projections')
      .doc('sender').collection('chats').doc(chatId);
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      await chat.collection('messages').doc('001').set({
        senderId: 'sender', status: 'sent',
      });
      const results = await Promise.allSettled([
        reconcileDirectUnreadMessage(chatId, '001', ['sender', 'recipient'], ['001']),
        chat.collection('messages').doc('002').set({
          senderId: 'sender', status: 'delivered',
        }),
      ]);
      assert.equal(results[1].status, 'fulfilled');
      // The transaction either preceded the insertion or rejected its snapshot.
      // Reconcile both under the new canonical set and verify idempotency.
      await reconcileDirectUnreadMessage(chatId, '001',
        ['sender', 'recipient'], ['001', '002']);
      await reconcileDirectUnreadMessage(chatId, '002',
        ['sender', 'recipient'], ['001', '002']);
      await reconcileDirectUnreadMessage(chatId, '001',
        ['sender', 'recipient'], ['001', '002']);
      assert.equal((await recipient.get()).data()?.unreadCount, 2);
      assert.equal((await recipient.collection('messages').get()).size, 2);
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all([db.recursiveDelete(recipient), db.recursiveDelete(sender)]);
    }
  });

  it('retries a transaction when a receipt changes after its reads', async () => {
    const chatId = `unread-read-conflict-${randomUUID()}`;
    const chat = db.collection('chats').doc(chatId);
    const message = chat.collection('messages').doc('001');
    const recipient = db.collection('direct_chat_unread_projections')
      .doc('recipient').collection('chats').doc(chatId);
    const sender = db.collection('direct_chat_unread_projections')
      .doc('sender').collection('chats').doc(chatId);
    let injected = false;
    try {
      await chat.set({ participants: ['sender', 'recipient'] });
      await message.set({ senderId: 'sender', status: 'sent' });
      await reconcileDirectUnreadMessage(chatId, '001',
        ['sender', 'recipient'], ['001'], async () => {
          if (injected) return;
          injected = true;
          await message.update({ status: 'read' });
        });
      assert.equal(injected, true);
      assert.equal((await recipient.get()).data()?.unreadCount ?? 0, 0);
      assert.equal((await recipient.collection('messages').doc('001').get()).data()?.status, 'read');
    } finally {
      await db.recursiveDelete(chat);
      await Promise.all([db.recursiveDelete(recipient), db.recursiveDelete(sender)]);
    }
  });

});
