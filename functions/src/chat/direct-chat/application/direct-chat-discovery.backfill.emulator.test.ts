import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { buildDirectChatPairIdentity } from '../domain/direct-chat.policy';
import { reconcileHistoricalDirectChatDiscovery } from './direct-chat-discovery.backfill';

const actualHost = process.env.FIRESTORE_EMULATOR_HOST;
const expectedHost = process.env.CHAT_RECONCILIATION_EXPECTED_EMULATOR_HOST;
if (expectedHost && actualHost !== expectedHost) {
  throw new Error('Wrong Firestore Emulator.');
}
const run = actualHost ? describe : describe.skip;

function invokeCli(args: string[], overrides: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [
    join(__dirname, 'direct-chat-discovery.backfill.emulator-cli.js'), ...args,
  ], {
    encoding: 'utf8',
    timeout: 20000,
    env: {
      ...process.env,
      GCLOUD_PROJECT: 'demo-entretenimento',
      GOOGLE_CLOUD_PROJECT: 'demo-entretenimento',
      GCP_PROJECT: 'demo-entretenimento',
      FIREBASE_CONFIG: JSON.stringify({ projectId: 'demo-entretenimento' }),
      GOOGLE_APPLICATION_CREDENTIALS: undefined,
      ...overrides,
    },
  });
}

run('CHAT-R1.3 — historical discovery backfill (Firestore emulator)', () => {
  it('adota histórico único sem amizade, preserva mensagens e é idempotente', async () => {
    const suffix = randomUUID();
    const a = `backfill-${suffix}-a`;
    const b = `backfill-${suffix}-b`;
    const pair = buildDirectChatPairIdentity(a, b);
    const chat = db.collection('chats').doc(`old-thread-${suffix}`);
    const message = chat.collection('messages').doc('retained');
    const registry = db.doc(`direct_chat_pairs/${pair.canonicalHash}`);
    const refs = pair.participants.map(uid =>
      db.doc(`direct_chat_discovery/${uid}/chats/${chat.id}`));
    const users = pair.participants.map(uid => db.doc(`users/${uid}`));
    try {
      await Promise.all([
        ...users.map((ref, index) => ref.set({ uid: pair.participants[index], accountStatus: 'active' })),
        chat.set({ participants: pair.participants, conversationType: 'direct' }),
        message.set({ senderId: a, text: 'histórico preservado' }),
      ]);
      for (const overrides of [
        { FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' },
        { GCLOUD_PROJECT: 'production' },
        { GOOGLE_APPLICATION_CREDENTIALS: '/private/credentials.json' },
      ]) {
        const denied = invokeCli([a, b, '--apply'], overrides);
        assert.equal(denied.status, 1);
        assert.equal(denied.stdout, '');
        assert.equal(denied.stderr, 'Historical discovery reconciliation failed.\n');
      }
      const dry = invokeCli([a, b]);
      assert.equal(dry.status, 0, dry.stderr);
      assert.equal(JSON.parse(dry.stdout).status, 'dry-run');
      for (const secret of [a, b, chat.id, pair.canonicalHash]) {
        assert.ok(!dry.stdout.includes(secret));
      }
      assert.equal((await registry.get()).exists, false);
      assert.equal((await refs[0].get()).exists, false);

      const applied = invokeCli([b, a, '--apply']);
      assert.equal(applied.status, 0, applied.stderr);
      assert.equal(JSON.parse(applied.stdout).status, 'applied');
      for (const secret of [a, b, chat.id, pair.canonicalHash]) {
        assert.ok(!applied.stdout.includes(secret));
      }
      assert.deepEqual((await registry.get()).data()?.['chatId'], chat.id);
      for (const ref of refs) {
        assert.deepEqual((await ref.get()).data(), { version: 1, chatId: chat.id });
      }
      assert.deepEqual((await message.get()).data(), {
        senderId: a, text: 'histórico preservado',
      });
      assert.equal((await reconcileHistoricalDirectChatDiscovery(a, b, true)).status, 'unchanged');
      assert.equal((await chat.collection('messages').get()).size, 1);
    } finally {
      await Promise.all([
        db.recursiveDelete(chat), registry.delete(),
        ...refs.map(ref => ref.delete()),
        ...users.map(ref => ref.delete()),
      ]);
    }
  });

  it('não cria referências para históricos múltiplos mesmo sem participantsKey', async () => {
    const suffix = randomUUID();
    const a = `ambiguous-${suffix}-a`;
    const b = `ambiguous-${suffix}-b`;
    const pair = buildDirectChatPairIdentity(a, b);
    const chats = [
      db.collection('chats').doc(`duplicate-a-${suffix}`),
      db.collection('chats').doc(`duplicate-b-${suffix}`),
    ];
    const registry = db.doc(`direct_chat_pairs/${pair.canonicalHash}`);
    const refs = pair.participants.flatMap(uid =>
      chats.map(chat => db.doc(`direct_chat_discovery/${uid}/chats/${chat.id}`)));
    try {
      await Promise.all(chats.map(chat => chat.set({
        participants: pair.participants, conversationType: 'direct',
      })));
      const result = await reconcileHistoricalDirectChatDiscovery(a, b, true);
      assert.equal(result.status, 'manual-review');
      assert.equal(result.reason, 'multiple-histories');
      assert.equal((await registry.get()).exists, false);
      for (const ref of refs) assert.equal((await ref.get()).exists, false);
      assert.ok((await chats[0].get()).exists);
      assert.ok((await chats[1].get()).exists);
    } finally {
      await Promise.all([...chats.map(chat => chat.delete()), registry.delete(), ...refs.map(ref => ref.delete())]);
    }
  });

  it('não recria referências para contas já excluídas', async () => {
    const suffix = randomUUID();
    const a = `retired-${suffix}-a`;
    const b = `retired-${suffix}-b`;
    const pair = buildDirectChatPairIdentity(a, b);
    const chat = db.collection('chats').doc(`retired-chat-${suffix}`);
    const registry = db.doc(`direct_chat_pairs/${pair.canonicalHash}`);
    const userA = db.doc(`users/${pair.participants[0]}`);
    const userB = db.doc(`users/${pair.participants[1]}`);
    try {
      await Promise.all([
        chat.set({ participants: pair.participants }),
        userA.set({ uid: userA.id, accountStatus: 'deleted' }),
        userB.set({ uid: userB.id }),
      ]);
      const result = await reconcileHistoricalDirectChatDiscovery(a, b, true);
      assert.equal(result.status, 'manual-review');
      assert.equal(result.reason, 'account-unavailable');
      assert.equal((await registry.get()).exists, false);
    } finally {
      await Promise.all([chat.delete(), userA.delete(), userB.delete(), registry.delete()]);
    }
  });
});
