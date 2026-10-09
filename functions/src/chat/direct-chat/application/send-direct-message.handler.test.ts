import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { db } from '../../../firebaseApp';
import { TERMS_ACCEPTANCE_VERSION, ADULT_CONSENT_VERSION } from '../../../compliance/platform-legal.constants';

const emulatorConfigured = !!process.env.FIRESTORE_EMULATOR_HOST;
const run = emulatorConfigured ? describe : describe.skip;

run('sendDirectMessage — Firestore Emulator transactional integration', () => {
  let invoke: (data: unknown, options: unknown) => Promise<any>;
  let cleanup: (() => void) | undefined;
  const prefix = `dm-integration-${randomUUID()}`;
  const actorUid = `${prefix}-a`;
  const targetUid = `${prefix}-b`;
  const chatId = `${prefix}-chat`;

  before(async () => {
    const firebaseFunctionsTest = require('firebase-functions-test');
    const testEnvironment = firebaseFunctionsTest({
      projectId: process.env.GCLOUD_PROJECT || 'demo-entretenimento',
    });
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
    invoke({
      data: { chatId, content, clientRequestId },
      auth: { uid: actorUid, token: { email_verified: true } },
    }, {});

  it('deduplica duas chamadas simultâneas com o mesmo requestId', async () => {
    const id = randomUUID();
    const results = await Promise.all([
      send('mensagem concorrente', id),
      send('mensagem concorrente', id),
    ]);
    assert.equal(results[0].messageId, results[1].messageId);
    assert.equal(
      results.filter((item: any) => item.deduplicated === false).length,
      1
    );
    const messages = await db.collection(`chats/${chatId}/messages`).get();
    assert.equal(messages.size, 1);
    const chat = await db.doc(`chats/${chatId}`).get();
    assert.equal(chat.data()?.lastMessage?.content, 'mensagem concorrente');
    assert.equal(chat.data()?.lastMessage?.messageId, results[0].messageId);
  });

  it('rejeita reutilização do requestId com conteúdo divergente', async () => {
    const id = randomUUID();
    await send('conteúdo original', id);
    await assert.rejects(send('conteúdo alterado', id), (error: any) =>
      String(error?.code ?? '').includes('already-exists')
    );
  });

  it('mantém preview coerente sob envios concorrentes com IDs diferentes', async () => {
    const first = randomUUID();
    const second = randomUUID();
    const [a, b] = await Promise.all([
      send('concorrente A', first),
      send('concorrente B', second),
    ]);
    assert.notEqual(a.messageId, b.messageId);
    assert.equal(a.deduplicated, false);
    assert.equal(b.deduplicated, false);

    const [messages, chat] = await Promise.all([
      db.collection(`chats/${chatId}/messages`).get(),
      db.doc(`chats/${chatId}`).get(),
    ]);
    const ids = new Set(messages.docs.map((doc) => doc.id));
    assert.ok(ids.has(a.messageId));
    assert.ok(ids.has(b.messageId));
    const preview = chat.data()?.lastMessage;
    assert.ok(['concorrente A', 'concorrente B'].includes(preview?.content));
    assert.equal(preview?.senderId, actorUid);
    assert.ok([a.messageId, b.messageId].includes(preview?.messageId));
  });

  it('impede novo envio depois de bloqueio bilateral confirmado', async () => {
    const blockRef = db.doc(`users/${targetUid}/blocks/${actorUid}`);
    await blockRef.set({ isBlocked: true });
    try {
      const id = randomUUID();
      await assert.rejects(send('bloqueado', id), (error: any) =>
        String(error?.code ?? '').includes('permission-denied')
      );
      const messages = await db.collection(`chats/${chatId}/messages`)
        .where('clientRequestId', '==', id).get();
      assert.equal(messages.size, 0);
    } finally {
      await blockRef.delete();
    }
  });

  it('impede novo envio depois de suspensão confirmada', async () => {
    const actorRef = db.doc(`users/${actorUid}`);
    await actorRef.update({ accountStatus: 'suspended' });
    try {
      const id = randomUUID();
      await assert.rejects(send('suspenso', id), (error: any) =>
        ['permission-denied', 'failed-precondition'].some((code) =>
          String(error?.code ?? '').includes(code)
        )
      );
      const messages = await db.collection(`chats/${chatId}/messages`)
        .where('clientRequestId', '==', id).get();
      assert.equal(messages.size, 0);
    } finally {
      await actorRef.update({ accountStatus: 'active' });
    }
  });

  /**
   * Pausa a primeira tentativa antes das leituras da transação.
   * A revogação é confirmada enquanto o envio está pendente e antes
   * de adquirir locks sobre os documentos de autorização.
   * Firestore pode usar locks pessimistas: pausar após ler e tentar
   * atualizar o mesmo documento criaria um impasse artificial.
   */
  async function assertRevocationWinsRace(
    label: string,
    revoke: () => Promise<unknown>,
    restore: () => Promise<unknown>,
    acceptedErrors: string[]
  ): Promise<void> {
    const id = randomUUID();
    const chatRef = db.doc(`chats/${chatId}`);
    const previewBefore = (await chatRef.get()).data()?.lastMessage;
    const originalRunTransaction = db.runTransaction.bind(db);
    let signalPaused!: () => void;
    let releaseCommit!: () => void;
    let intercepted = false;
    const paused = new Promise<void>((resolve) => { signalPaused = resolve; });
    const released = new Promise<void>((resolve) => { releaseCommit = resolve; });

    (db as any).runTransaction = (callback: any, options?: any) =>
      originalRunTransaction(async (transaction) => {
        if (!intercepted) {
          intercepted = true;
          signalPaused();
          await released;
        }
        return callback(transaction);
      }, options);

    try {
      const attemptedSend = send(label, id);
      // Anexa a rejeição imediatamente para evitar unhandled rejection.
      const settled = attemptedSend.then(
        (value: any) => ({ value, error: null }),
        (error: any) => ({ value: null, error })
      );
      await paused;
      await revoke();
      releaseCommit();
      const outcome = await settled;
      assert.ok(outcome.error, 'envio deveria falhar após revogação');
      assert.ok(
        acceptedErrors.some((code) =>
          String(outcome.error?.code ?? '').includes(code)
        ),
        `erro inesperado: ${String(outcome.error?.code)}`
      );
      const [messages, chat] = await Promise.all([
        db.collection(`chats/${chatId}/messages`)
          .where('clientRequestId', '==', id).get(),
        chatRef.get(),
      ]);
      assert.equal(messages.size, 0, 'revogação não pode criar mensagem');
      assert.deepEqual(
        chat.data()?.lastMessage,
        previewBefore,
        'envio rejeitado não deve modificar o preview'
      );
    } finally {
      releaseCommit();
      (db as any).runTransaction = originalRunTransaction;
      await restore();
    }
  }

  it('confirma bloqueio antes da leitura transacional pendente', async () => {
    const ref = db.doc(`users/${targetUid}/blocks/${actorUid}`);
    await assertRevocationWinsRace(
      'corrida-bloqueio',
      () => ref.set({ isBlocked: true }),
      () => ref.delete(),
      ['permission-denied']
    );
  });

  it('confirma suspensão antes da leitura transacional pendente', async () => {
    const ref = db.doc(`users/${actorUid}`);
    await assertRevocationWinsRace(
      'corrida-suspensão',
      () => ref.update({ accountStatus: 'suspended' }),
      () => ref.update({ accountStatus: 'active' }),
      ['permission-denied', 'failed-precondition']
    );
  });

  it('remove conexão antes da leitura transacional pendente', async () => {
    const ref = db.doc(`users/${targetUid}/friends/${actorUid}`);
    await assertRevocationWinsRace(
      'corrida-amizade',
      () => ref.delete(),
      () => ref.set({ accepted: true }),
      ['failed-precondition']
    );
  });

  it('nega envio quando a amizade bilateral é removida', async () => {
    await db.doc(`users/${targetUid}/friends/${actorUid}`).delete();
    await assert.rejects(send('não autorizado', randomUUID()), (error: any) =>
      String(error?.code ?? '').includes('failed-precondition')
    );
  });
});
