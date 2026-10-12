import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { TERMS_ACCEPTANCE_VERSION, ADULT_CONSENT_VERSION } from '../../../compliance/platform-legal.constants';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('reconcileDirectChatAccess — bounded bilateral projection', () => {
  const prefix = `access-reconcile-${randomUUID()}`;
  const left = `${prefix}-a`;
  const right = `${prefix}-b`;
  const leftAccess = db.doc(`direct_chat_access/${left}/peers/${right}`);
  const rightAccess = db.doc(`direct_chat_access/${right}/peers/${left}`);
  const leftBlock = db.doc(`users/${left}/blocks/${right}`);
  const rightBlock = db.doc(`users/${right}/blocks/${left}`);
  let invoke: (request: unknown, options: unknown) => Promise<any>;
  let cleanup: (() => void) | undefined;

  const user = (uid: string) => ({
    uid, profileCompleted: true, nickname: uid, accountStatus: 'active',
    acceptedTerms: {
      accepted: true, version: TERMS_ACCEPTANCE_VERSION,
      acknowledgedPrivacyNotice: true,
    },
    adultConsent: { accepted: true, version: ADULT_CONSENT_VERSION },
  });
  const request = (actor = left, target = right) => invoke({
    data: { peerUid: target },
    auth: { uid: actor, token: { email_verified: true } },
  }, {});

  before(async () => {
    const firebaseFunctionsTest = require('firebase-functions-test');
    const environment = firebaseFunctionsTest({
      projectId: process.env.GCLOUD_PROJECT || 'demo-entretenimento',
    });
    cleanup = () => environment.cleanup();
    const { reconcileDirectChatAccess } = require('./reconcile-direct-chat-access.handler');
    invoke = environment.wrap(reconcileDirectChatAccess);
    await Promise.all([
      db.doc(`users/${left}`).set(user(left)),
      db.doc(`users/${right}`).set(user(right)),
      db.doc(`users/${left}/friends/${right}`).set({ accepted: true }),
      db.doc(`users/${right}/friends/${left}`).set({ accepted: true }),
    ]);
  });
  after(async () => {
    await Promise.all([
      db.recursiveDelete(db.doc(`users/${left}`)),
      db.recursiveDelete(db.doc(`users/${right}`)),
      db.recursiveDelete(db.doc(`direct_chat_access/${left}`)),
      db.recursiveDelete(db.doc(`direct_chat_access/${right}`)),
    ]);
    cleanup?.();
  });

  it('preenche par legado e reexecução não regrava projeções', async () => {
    assert.equal((await leftAccess.get()).exists, false);
    await request();
    const [a, b] = await Promise.all([leftAccess.get(), rightAccess.get()]);
    assert.equal(a.data()?.available, true);
    assert.equal(b.data()?.available, true);
    assert.equal(a.data()?.version, 1);
    const updatedAt = a.data()?.updatedAt?.toMillis();
    await request();
    assert.equal((await leftAccess.get()).data()?.updatedAt?.toMillis(), updatedAt);
  });

  it('bloqueio em qualquer direção revoga ambos os espelhos sem revelar autoria', async () => {
    await rightBlock.set({ isBlocked: true });
    const response = await request();
    assert.deepEqual(response, { reconciled: true });
    assert.equal((await leftAccess.get()).data()?.available, false);
    assert.equal((await rightAccess.get()).data()?.available, false);
    await rightBlock.delete();
    await leftBlock.set({ isBlocked: true });
    await request();
    assert.equal((await leftAccess.get()).data()?.available, false);
    await leftBlock.delete();
    await request();
    assert.equal((await leftAccess.get()).data()?.available, true);
  });

  it('sem amizade bilateral mantém projeção indisponível', async () => {
    const friend = db.doc(`users/${right}/friends/${left}`);
    await friend.delete();
    try {
      await request();
      assert.equal((await leftAccess.get()).data()?.available, false);
      assert.equal((await rightAccess.get()).data()?.available, false);
    } finally {
      await friend.set({ accepted: true });
    }
  });

  it('não aceita consulta de par alheio nem UIDs inválidos', async () => {
    await assert.rejects(request('outsider', right));
    await assert.rejects(request(left, left));
  });
});
