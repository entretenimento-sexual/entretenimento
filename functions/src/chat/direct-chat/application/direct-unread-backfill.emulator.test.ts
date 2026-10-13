import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { initializeDirectUnreadOnEmulator } from './direct-unread-backfill.emulator';

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

});
