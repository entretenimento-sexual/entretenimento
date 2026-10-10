import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { buildDirectChatPairIdentity } from '../domain/direct-chat.policy';
import { after, before, describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import {
  TERMS_ACCEPTANCE_VERSION,
  ADULT_CONSENT_VERSION,
} from '../../../compliance/platform-legal.constants';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('ensureDirectChat — Firestore Emulator transaction and access', () => {
  const prefix = `ensure-chat-${randomUUID()}`;
  const actorUid = `${prefix}-a`;
  const targetUid = `${prefix}-b`;
  const identity = buildDirectChatPairIdentity(actorUid, targetUid);
  const pairHash = identity.canonicalHash;
  const registryRef = db.doc(`direct_chat_pairs/${pairHash}`);
  const canonicalRef = db.doc(`chats/direct_${pairHash}`);
  const actorBlockRef = db.doc(`users/${actorUid}/blocks/${targetUid}`);
  const targetBlockRef = db.doc(`users/${targetUid}/blocks/${actorUid}`);
  let invoke: (request: unknown, options: unknown) => Promise<any>;
  let cleanup: (() => void) | undefined;

  function user(uid: string) {
    return {
      uid,
      profileCompleted: true,
      nickname: uid,
      accountStatus: 'active',
      acceptedTerms: {
        accepted: true,
        version: TERMS_ACCEPTANCE_VERSION,
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: { accepted: true, version: ADULT_CONSENT_VERSION },
    };
  }

  function ensure() {
    return invoke({
      data: { otherUserUid: targetUid },
      auth: { uid: actorUid, token: { email_verified: true } },
    }, {});
  }

  before(async () => {
    const firebaseFunctionsTest = require('firebase-functions-test');
    const testEnvironment = firebaseFunctionsTest({
      projectId: process.env.GCLOUD_PROJECT || 'demo-entretenimento',
    });
    cleanup = () => testEnvironment.cleanup();
    const { ensureDirectChat } = require('./ensure-direct-chat.handler');
    invoke = testEnvironment.wrap(ensureDirectChat);

    await Promise.all([
      db.doc(`users/${actorUid}`).set(user(actorUid)),
      db.doc(`users/${targetUid}`).set(user(targetUid)),
      db.doc(`users/${actorUid}/friends/${targetUid}`).set({ accepted: true }),
      db.doc(`users/${targetUid}/friends/${actorUid}`).set({ accepted: true }),
    ]);
  });

  after(async () => {
    await Promise.all([
      db.recursiveDelete(db.doc(`users/${actorUid}`)),
      db.recursiveDelete(db.doc(`users/${targetUid}`)),
      db.recursiveDelete(canonicalRef),
      registryRef.delete(),
    ]);
    cleanup?.();
  });

  it('duas aberturas simultâneas convergem ao mesmo chat determinístico', async () => {
    const [first, second] = await Promise.all([ensure(), ensure()]);
    assert.equal(first.chatId, canonicalRef.id);
    assert.equal(second.chatId, canonicalRef.id);
    assert.equal([first, second].filter((v) => v.created).length, 1);
    const [canonical, registry] = await Promise.all([
      canonicalRef.get(), registryRef.get(),
    ]);
    assert.equal(canonical.exists, true);
    assert.equal(registry.data()?.chatId, canonicalRef.id);
    assert.deepEqual(canonical.data()?.participants, [actorUid, targetUid].sort());
    assert.equal(canonical.data()?.participantsKey, identity.canonicalKey);
    assert.equal(canonical.data()?.pairKeyVersion, 2);
  });

  for (const [label, blockRef] of [
    ['ator bloqueia destinatário', actorBlockRef],
    ['destinatário bloqueia ator', targetBlockRef],
  ] as const) {
    it(`bloqueio bilateral impede recuperar chat registrado: ${label}`, async () => {
      await blockRef.set({ isBlocked: true });
      try {
        await assert.rejects(ensure(), (error: any) =>
          String(error?.code ?? '').includes('permission-denied')
        );
      } finally {
        await blockRef.delete();
      }
    });
  }

  it('registro canônico malformado falha fechado sem adotar sala', async () => {
    await canonicalRef.update({ isRoom: true });
    try {
      await assert.rejects(ensure(), (error: any) =>
        String(error?.code ?? '').includes('data-loss')
      );
    } finally {
      await canonicalRef.update({ isRoom: false });
    }
  });

  it('revogação da amizade impede recuperar chat existente', async () => {
    const friendRef = db.doc(`users/${targetUid}/friends/${actorUid}`);
    await friendRef.delete();
    try {
      await assert.rejects(ensure(), (error: any) =>
        String(error?.code ?? '').includes('failed-precondition')
      );
    } finally {
      await friendRef.set({ accepted: true });
    }
  });
});
