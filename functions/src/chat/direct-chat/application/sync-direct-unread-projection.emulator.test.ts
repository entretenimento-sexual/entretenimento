import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { reconcileDirectUnreadMessage } from './sync-direct-unread-projection.trigger';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('direct unread projection — Firestore emulator', () => {
  const chatId = `unread-${randomUUID()}`;
  const chatRef = db.collection('chats').doc(chatId);
  const messageRef = chatRef.collection('messages').doc('msg-1');
  const projection = (uid: string) => db.collection('direct_chat_unread_projections')
    .doc(uid).collection('chats').doc(chatId);
  const count = async (uid: string) => (await projection(uid).get()).data()?.unreadCount ?? 0;

  before(async () => {
    await chatRef.set({ participants: ['sender', 'recipient'] });
  });
  after(async () => {
    await db.recursiveDelete(chatRef);
    await Promise.all([
      db.recursiveDelete(projection('sender')),
      db.recursiveDelete(projection('recipient')),
    ]);
  });

  it('converges under duplicates, parallel retries and receipt progression', async () => {
    await messageRef.set({ senderId: 'sender', status: 'sent', content: 'private' });
    await Promise.all([
      reconcileDirectUnreadMessage(chatId, 'msg-1'),
      reconcileDirectUnreadMessage(chatId, 'msg-1'),
    ]);
    assert.equal(await count('recipient'), 1);
    assert.equal(await count('sender'), 0);
    await messageRef.update({ status: 'delivered' });
    await reconcileDirectUnreadMessage(chatId, 'msg-1');
    assert.equal(await count('recipient'), 1);
    await messageRef.update({ status: 'read' });
    await Promise.all([
      reconcileDirectUnreadMessage(chatId, 'msg-1'),
      reconcileDirectUnreadMessage(chatId, 'msg-1'),
    ]);
    assert.equal(await count('recipient'), 0);
    const checkpoint = await projection('recipient').collection('messages').doc('msg-1').get();
    assert.equal(checkpoint.data()?.status, 'read');
    assert.equal(checkpoint.data()?.content, undefined);
  });

  it('removes unread contribution after delete without duplicate decrements', async () => {
    await messageRef.set({ senderId: 'sender', status: 'sent' });
    await reconcileDirectUnreadMessage(chatId, 'msg-1');
    assert.equal(await count('recipient'), 1);
    await messageRef.update({ deleted: true });
    await Promise.all([
      reconcileDirectUnreadMessage(chatId, 'msg-1'),
      reconcileDirectUnreadMessage(chatId, 'msg-1'),
    ]);
    assert.equal(await count('recipient'), 0);
  });
});
