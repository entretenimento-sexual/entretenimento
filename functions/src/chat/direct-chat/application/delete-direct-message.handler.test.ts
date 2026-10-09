import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '../../../firebaseApp';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('deleteDirectMessage — Firestore Emulator integration', () => {
  let invoke: (data: unknown, options: unknown) => Promise<any>;
  let cleanup: (() => void) | undefined;
  const prefix = `dm-delete-${randomUUID()}`;
  const actor = `${prefix}-actor`;
  const peer = `${prefix}-peer`;
  const chatId = `${prefix}-chat`;
  const chatRef = db.doc(`chats/${chatId}`);
  const message = (id: string) => chatRef.collection('messages').doc(id);
  const call = (uid: string, id: string) => invoke({
    data: { chatId, messageId: id },
    auth: { uid, token: { email_verified: true } },
  }, {});

  before(async () => {
    const firebaseFunctionsTest = require('firebase-functions-test');
    const testEnvironment = firebaseFunctionsTest({
      projectId: process.env.GCLOUD_PROJECT || 'demo-entretenimento',
    });
    cleanup = () => testEnvironment.cleanup();
    const { deleteDirectMessage } = require('./delete-direct-message.handler');
    invoke = testEnvironment.wrap(deleteDirectMessage);
    await chatRef.set({ participants: [actor, peer] });
  });

  after(async () => {
    await db.recursiveDelete(chatRef);
    cleanup?.();
  });

  it('não altera preview de outra mensagem com mesmo texto', async () => {
    const oldId = randomUUID();
    const latestId = randomUUID();
    await message(oldId).set({ senderId: actor, content: 'igual', status: 'sent' });
    await message(latestId).set({ senderId: actor, content: 'igual', status: 'sent' });
    await chatRef.update({
      lastMessage: { messageId: latestId, senderId: actor, content: 'igual' },
    });
    await call(actor, oldId);
    assert.equal((await message(oldId).get()).data()?.deleted, true);
    const preview = (await chatRef.get()).data()?.lastMessage;
    assert.equal(preview.messageId, latestId);
    assert.equal(preview.content, 'igual');

    await call(actor, latestId);
    const updated = (await chatRef.get()).data()?.lastMessage;
    assert.equal(updated.messageId, latestId);
    assert.equal(updated.content, 'Mensagem apagada');
    assert.equal(updated.deleted, true);
    await call(actor, latestId);
    assert.equal((await chatRef.get()).data()?.lastMessage?.messageId, latestId);
  });

  it('preserva preview legado sem messageId e bloqueia exclusão por terceiro', async () => {
    const id = randomUUID();
    await message(id).set({ senderId: actor, content: 'legado' });
    await chatRef.update({
      lastMessage: { senderId: actor, content: 'legado' },
    });
    await assert.rejects(call(peer, id), (error: any) =>
      String(error?.code ?? '').includes('permission-denied')
    );
    assert.equal((await message(id).get()).data()?.deleted, undefined);
    await call(actor, id);
    const preview = (await chatRef.get()).data()?.lastMessage;
    assert.equal(preview.content, 'legado');
    assert.equal(preview.messageId, undefined);
  });
});
