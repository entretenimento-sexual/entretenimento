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

  it('recupera chat determinístico v1 sem participantsKey e sem registry', async () => {
    const left = `${prefix}-legacy-left`;
    const right = `${prefix}-legacy-right`;
    const identity = buildDirectChatPairIdentity(left, right);
    const oldRef = db.doc(`chats/direct_${identity.legacyHash}`);
    const newRegistry = db.doc(`direct_chat_pairs/${identity.canonicalHash}`);
    const newChat = db.doc(`chats/direct_${identity.canonicalHash}`);
    try {
      await Promise.all([
        db.doc(`users/${left}`).set(user(left)),
        db.doc(`users/${right}`).set(user(right)),
        db.doc(`users/${left}/friends/${right}`).set({ accepted: true }),
        db.doc(`users/${right}/friends/${left}`).set({ accepted: true }),
        oldRef.set({
          participants: identity.participants,
          conversationType: 'direct',
          conversationStatus: 'active',
        }),
      ]);
      const result = await invoke({
        data: { otherUserUid: right },
        auth: { uid: left, token: { email_verified: true } },
      }, {});
      assert.equal(result.chatId, oldRef.id);
      assert.equal(result.created, false);
      assert.equal((await newRegistry.get()).data()?.chatId, oldRef.id);
      assert.equal((await newChat.get()).exists, false);
    } finally {
      await Promise.all([
        db.recursiveDelete(db.doc(`users/${left}`)),
        db.recursiveDelete(db.doc(`users/${right}`)),
        db.recursiveDelete(oldRef),
        newRegistry.delete(),
      ]);
    }
  });

  it('não escolhe silenciosamente entre dois históricos v1 diferentes', async () => {
    const left = `${prefix}-duplicate-left`;
    const right = `${prefix}-duplicate-right`;
    const pair = buildDirectChatPairIdentity(left, right);
    const oldDeterministic = db.doc(`chats/direct_${pair.legacyHash}`);
    const oldIndexed = db.doc(`chats/legacy_indexed_${randomUUID()}`);
    const newRegistry = db.doc(`direct_chat_pairs/${pair.canonicalHash}`);
    try {
      await Promise.all([
        db.doc(`users/${left}`).set(user(left)),
        db.doc(`users/${right}`).set(user(right)),
        db.doc(`users/${left}/friends/${right}`).set({ accepted: true }),
        db.doc(`users/${right}/friends/${left}`).set({ accepted: true }),
        oldDeterministic.set({ participants: pair.participants }),
        oldIndexed.set({
          participants: pair.participants,
          participantsKey: pair.legacyKey,
        }),
      ]);
      await assert.rejects(invoke({
        data: { otherUserUid: right },
        auth: { uid: left, token: { email_verified: true } },
      }, {}), (error: any) =>
        String(error?.code ?? '').includes('failed-precondition')
      );
      assert.equal((await newRegistry.get()).exists, false);
      assert.equal((await oldDeterministic.get()).exists, true);
      assert.equal((await oldIndexed.get()).exists, true);
    } finally {
      await Promise.all([
        db.recursiveDelete(db.doc(`users/${left}`)),
        db.recursiveDelete(db.doc(`users/${right}`)),
        db.recursiveDelete(oldDeterministic),
        db.recursiveDelete(oldIndexed),
        newRegistry.delete(),
      ]);
    }
  });

  it('mantém pares distintos isolados mesmo quando suas chaves v1 colidem', async () => {
    const x = `${prefix}-x`;
    const y = `${prefix}-y`;
    const z = `${prefix}-z`;
    const pairA = buildDirectChatPairIdentity(x, `${y}_${z}`);
    const pairB = buildDirectChatPairIdentity(`${x}_${y}`, z);
    assert.equal(pairA.legacyHash, pairB.legacyHash);
    assert.notEqual(pairA.canonicalHash, pairB.canonicalHash);

    const allUids = [...new Set([...pairA.participants, ...pairB.participants])];
    const legacyChatRef = db.doc(`chats/legacy_collision_${randomUUID()}`);
    const oldRegistryRef = db.doc(`direct_chat_pairs/${pairA.legacyHash}`);
    const canonicalA = db.doc(`direct_chat_pairs/${pairA.canonicalHash}`);
    const canonicalB = db.doc(`direct_chat_pairs/${pairB.canonicalHash}`);
    const newChatB = db.doc(`chats/direct_${pairB.canonicalHash}`);

    try {
      await Promise.all(allUids.map((uid) =>
        db.doc(`users/${uid}`).set(user(uid))
      ));
      for (const pair of [pairA, pairB]) {
        await Promise.all([
          db.doc(`users/${pair.participants[0]}/friends/${pair.participants[1]}`)
            .set({ accepted: true }),
          db.doc(`users/${pair.participants[1]}/friends/${pair.participants[0]}`)
            .set({ accepted: true }),
        ]);
      }
      await legacyChatRef.set({
        participants: pairA.participants,
        participantsKey: pairA.legacyKey,
        timestamp: new Date(),
      });
      await oldRegistryRef.set({ chatId: legacyChatRef.id });

      const call = (actorUid: string, otherUserUid: string) =>
        invoke({
          data: { otherUserUid },
          auth: { uid: actorUid, token: { email_verified: true } },
        }, {});
      const first = await call(...pairA.participants);
      const second = await call(...pairB.participants);
      assert.equal(first.chatId, legacyChatRef.id);
      assert.equal(first.created, false);
      assert.equal(second.chatId, newChatB.id);
      assert.equal(second.created, true);

      const [registryA, registryB, priorRegistry, chatB] = await Promise.all([
        canonicalA.get(), canonicalB.get(), oldRegistryRef.get(), newChatB.get(),
      ]);
      assert.equal(registryA.data()?.chatId, legacyChatRef.id);
      assert.equal(registryB.data()?.chatId, newChatB.id);
      assert.equal(priorRegistry.data()?.chatId, legacyChatRef.id);
      assert.equal(chatB.data()?.participantsKey, pairB.canonicalKey);
    } finally {
      await Promise.all([
        ...allUids.map((uid) => db.recursiveDelete(db.doc(`users/${uid}`))),
        db.recursiveDelete(legacyChatRef),
        db.recursiveDelete(newChatB),
        oldRegistryRef.delete(),
        canonicalA.delete(),
        canonicalB.delete(),
      ]);
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
