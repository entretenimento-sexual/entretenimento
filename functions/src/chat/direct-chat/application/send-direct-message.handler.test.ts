import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { getFirestore } from 'firebase-admin/firestore';
import { TERMS_ACCEPTANCE_VERSION, ADULT_CONSENT_VERSION } from '../../../compliance/platform-legal.constants';

const emulatorConfigured = !!process.env.FIRESTORE_EMULATOR_HOST;
const run = emulatorConfigured ? describe : describe.skip;

run('sendDirectMessage — Firestore Emulator transactional integration', () => {
  let invoke: (data: unknown, options: unknown) => Promise<any>;
  let cleanup: (() => void) | undefined;
  const db = getFirestore();
  const prefix = `dm-integration-${randomUUID()}`;
  const actorUid = `${prefix}-a`;
  const targetUid = `${prefix}-b`;
  const chatId = `${prefix}-chat`;

  before(async () => {
    const firebaseFunctionsTest = require('firebase-functions-test');
    const testEnvironment = firebaseFunctionsTest({ projectId: process.env.GCLOUD_PROJECT || 'demo-entretenimento' });
    cleanup = () => testEnvironment.cleanup();
    const { sendDirectMessage } = require('./send-direct-message.handler');
    invoke = testEnvironment.wrap(sendDirectMessage);
    const profile = (uid: string) => ({
      uid,
      nickname: uid,
      accountStatus: 'active',
      profileCompleted: true,
      acceptedTerms: {
        accepted: true,
        version: TERMS_ACCEPTANCE_VERSION,
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: { accepted: true, version: ADULT_CONSENT_VERSION },
    });
    await Promise.all([
      db.doc(`users/${actorUid}`).set(profile(actorUid)),
      db.doc(`users/${targetUid}`).set(profile(targetUid)),
      db.doc(`users/${actorUid}/friends/${targetUid}`).set({ accepted: true }),
      db.doc(`users/${targetUid}/friends/${actorUid}`).set({ accepted: true }),
      db.doc(`chats/${chatId}`).set({
        participants: [actorUid, targetUid],
        conversationType: 'direct',
        conversationStatus: 'active',
      }),
    ]);
  });

  after(async () => {
    await db.recursiveDelete(db.doc(`chats/${chatId}`));
    await db.recursiveDelete(db.doc(`users/${actorUid}`));
    await db.recursiveDelete(db.doc(`users/${targetUid}`));
    cleanup?.();
  });

  const send = (content: string, clientRequestId: string) =>
    invoke({ chatId, content, clientRequestId }, {
      auth: { uid: actorUid, token: { email_verified: true } },
    });

  it('deduplica duas chamadas simultâneas com o mesmo requestId', async () => {
    const id = randomUUID();
    const results = await Promise.all([send('mensagem concorrente', id), send('mensagem concorrente', id)]);
    assert.equal(results[0].messageId, results[1].messageId);
    assert.equal(results.filter((item: any) => item.deduplicated === false).length, 1);
    const messages = await db.collection(`chats/${chatId}/messages`).get();
    assert.equal(messages.size, 1);
    const chat = await db.doc(`chats/${chatId}`).get();
    assert.equal(chat.data()?.lastMessage?.content, 'mensagem concorrente');
  });

  it('rejeita reutilização do requestId com conteúdo divergente', async () => {
    const id = randomUUID();
    await send('conteúdo original', id);
    await assert.rejects(send('conteúdo alterado', id), (error: any) =>
      String(error?.code ?? '').includes('already-exists')
    );
  });

  it('nega envio quando a amizade bilateral é removida', async () => {
    await db.doc(`users/${targetUid}/friends/${actorUid}`).delete();
    await assert.rejects(send('não autorizado', randomUUID()), (error: any) =>
      String(error?.code ?? '').includes('failed-precondition')
    );
  });
});
