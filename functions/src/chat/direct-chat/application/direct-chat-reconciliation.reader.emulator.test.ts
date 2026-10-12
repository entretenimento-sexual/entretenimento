import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { buildDirectChatPairIdentity } from '../domain/direct-chat.policy';
import { readDirectChatReconciliation } from './direct-chat-reconciliation.reader';

const expectedHost = process.env.CHAT_RECONCILIATION_EXPECTED_EMULATOR_HOST;
const actualHost = process.env.FIRESTORE_EMULATOR_HOST;
if (expectedHost && actualHost !== expectedHost) {
  throw new Error('A integração foi direcionada a outro Firestore Emulator.');
}
const run = actualHost ? describe : describe.skip;

run('direct chat reconciliation — Firestore emulator', () => {
  it('executa CLI isolado com históricos conflitantes sem expor IDs nem modificar dados', async () => {
    const suffix = randomUUID();
    const participants: [string, string] = [
      `audit-cli-${suffix}-a`, `audit-cli-${suffix}-b`,
    ];
    const pair = buildDirectChatPairIdentity(...participants);
    const first = db.collection('chats').doc(`audit-cli-first-${suffix}`);
    const second = db.collection('chats').doc(`audit-cli-second-${suffix}`);
    const registry = db.doc(`direct_chat_pairs/${pair.canonicalHash}`);
    const data = {
      participants: pair.participants,
      participantsKey: pair.legacyKey,
      conversationType: 'direct',
    };
    try {
      await Promise.all([
        first.set(data), second.set(data),
        registry.set({ chatId: first.id, version: 2 }),
      ]);
      const before = await Promise.all([first.get(), second.get(), registry.get()]);
      const result = spawnSync(process.execPath, [
        join(__dirname, 'direct-chat-reconciliation.emulator-cli.js'),
        ...participants,
      ], {
        encoding: 'utf8',
        timeout: 15000,
        env: {
          ...process.env,
          FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
          GCLOUD_PROJECT: 'demo-entretenimento',
          GOOGLE_CLOUD_PROJECT: 'demo-entretenimento',
          GCP_PROJECT: 'demo-entretenimento',
          FIREBASE_CONFIG: JSON.stringify({
            projectId: 'demo-entretenimento',
            project_id: 'demo-entretenimento',
          }),
          GOOGLE_APPLICATION_CREDENTIALS: undefined,
        },
      });
      assert.equal(result.status, 0, result.stderr);
      const report: Record<string, unknown> = JSON.parse(result.stdout);
      assert.deepEqual(Object.keys(report).sort(), [
        'mode', 'findings', 'eligibleHistoryCount', 'inspectedDocuments',
        'boundedQuery', 'requiresManualReview',
      ].sort());
      assert.equal(report.mode, 'DRY_RUN');
      assert.equal(report.eligibleHistoryCount, 2);
      assert.equal(report.requiresManualReview, true);
      assert.ok(Array.isArray(report.findings));
      assert.ok((report.findings as string[]).includes('MULTIPLE_HISTORIES'));
      for (const secret of [...participants, first.id, second.id, pair.canonicalHash]) {
        assert.ok(!result.stdout.includes(secret), 'CLI expôs um identificador');
      }
      const after = await Promise.all([first.get(), second.get(), registry.get()]);
      assert.deepEqual(after.map((doc) => doc.data()), before.map((doc) => doc.data()));
    } finally {
      await Promise.all([first.delete(), second.delete(), registry.delete()]);
    }
  });

  it('sinaliza registry v2 cruzado e preserva todas as fontes em leituras repetidas', async () => {
    const suffix = randomUUID();
    const participants: [string, string] = [
      `audit-cross-${suffix}-a`, `audit-cross-${suffix}-b`,
    ];
    const pair = buildDirectChatPairIdentity(...participants);
    const registry = db.doc(`direct_chat_pairs/${pair.canonicalHash}`);
    const foreign = db.collection('chats').doc(`audit-foreign-${suffix}`);
    const original = {
      participants: [`unrelated-${suffix}-a`, `unrelated-${suffix}-b`],
      conversationType: 'direct',
    };
    try {
      await foreign.set(original);
      await registry.set({ chatId: foreign.id, version: 2 });
      const before = await Promise.all([registry.get(), foreign.get()]);
      const first = await readDirectChatReconciliation(db, participants);
      const second = await readDirectChatReconciliation(db, participants);
      const after = await Promise.all([registry.get(), foreign.get()]);
      assert.ok(first.findings.includes('CANONICAL_REGISTRY_WRONG_PAIR'));
      assert.equal(first.requiresManualReview, true);
      assert.deepEqual(second, first);
      assert.deepEqual(after.map((doc) => doc.data()), before.map((doc) => doc.data()));
    } finally {
      await Promise.all([registry.delete(), foreign.delete()]);
    }
  });

  it('mantém registros malformados intactos sem seguir chatId inseguro', async () => {
    const suffix = randomUUID();
    const participants: [string, string] = [
      `audit-invalid-${suffix}-a`, `audit-invalid-${suffix}-b`,
    ];
    const pair = buildDirectChatPairIdentity(...participants);
    const v1 = db.doc(`direct_chat_pairs/${pair.legacyHash}`);
    const v2 = db.doc(`direct_chat_pairs/${pair.canonicalHash}`);
    try {
      await Promise.all([
        v1.set({ chatId: 55, marker: 'unchanged' }),
        v2.set({ chatId: 'bad/path', marker: 'unchanged' }),
      ]);
      const before = await Promise.all([v1.get(), v2.get()]);
      const first = await readDirectChatReconciliation(db, participants);
      const second = await readDirectChatReconciliation(db, participants);
      const after = await Promise.all([v1.get(), v2.get()]);
      assert.ok(first.findings.includes('REFERENCE_NOT_VERIFIED'));
      assert.equal(first.requiresManualReview, true);
      assert.deepEqual(first, second);
      assert.deepEqual(after.map((doc) => doc.data()), before.map((doc) => doc.data()));
      assert.deepEqual(first.eligibleChatIds, []);
    } finally {
      await Promise.all([v1.delete(), v2.delete()]);
    }
  });

  it('não declara histórico único quando a consulta encontra onze candidatos', async () => {
    const suffix = randomUUID();
    const participants: [string, string] = [
      `audit-limit-${suffix}-a`, `audit-limit-${suffix}-b`,
    ];
    const pair = buildDirectChatPairIdentity(...participants);
    const refs = Array.from({ length: 11 }, (_, i) =>
      db.collection('chats').doc(`audit-limit-${suffix}-${i}`));
    const data = {
      participants: pair.participants, participantsKey: pair.legacyKey,
      conversationType: 'direct',
    };
    try {
      await Promise.all(refs.map((ref) => ref.set(data)));
      const before = await Promise.all(refs.map((ref) => ref.get()));
      const report = await readDirectChatReconciliation(db, participants);
      const after = await Promise.all(refs.map((ref) => ref.get()));
      assert.ok(report.findings.includes('SCAN_TRUNCATED'));
      assert.ok(report.findings.includes('MULTIPLE_HISTORIES'));
      assert.equal(report.requiresManualReview, true);
      assert.equal(report.eligibleChatIds.length, 11);
      assert.deepEqual(after.map((doc) => doc.data()), before.map((doc) => doc.data()));
    } finally {
      await Promise.all(refs.map((ref) => ref.delete()));
    }
  });

  it('diagnostica históricos duplicados sem alterar documentos', async () => {
    const suffix = randomUUID();
    const participants: [string, string] = [
      `audit-${suffix}-a`, `audit-${suffix}-b`,
    ];
    const pair = buildDirectChatPairIdentity(...participants);
    const first = db.collection('chats').doc(`audit-first-${suffix}`);
    const second = db.collection('chats').doc(`audit-second-${suffix}`);
    const data = {
      participants: pair.participants,
      participantsKey: pair.legacyKey,
      conversationType: 'direct',
    };
    try {
      await Promise.all([first.set(data), second.set(data)]);
      const before = await Promise.all([first.get(), second.get()]);
      const report = await readDirectChatReconciliation(db, participants);
      const after = await Promise.all([first.get(), second.get()]);
      assert.equal(report.requiresManualReview, true);
      assert.ok(report.findings.includes('MULTIPLE_HISTORIES'));
      assert.deepEqual(report.eligibleChatIds, [first.id, second.id].sort());
      assert.deepEqual(after.map((doc) => doc.data()), before.map((doc) => doc.data()));
      assert.equal((await db.doc(`direct_chat_pairs/${pair.canonicalHash}`).get()).exists, false);
    } finally {
      await Promise.all([first.delete(), second.delete()]);
    }
  });
  it('pagina histórico real por timestamp e ID sem pular mensagens empatadas', async () => {
    const suffix = randomUUID();
    const chat = db.collection('chats').doc(`paging-${suffix}`);
    const messages = chat.collection('messages');
    const stamp = Timestamp.fromMillis(1_700_000_000_000);
    const ids = Array.from({ length: 45 }, (_, index) =>
      `message-${String(index).padStart(3, '0')}`);
    try {
      const batch = db.batch();
      for (const id of ids) {
        batch.set(messages.doc(id), { timestamp: stamp, senderId: 'paging-test' });
      }
      await batch.commit();

      const base = messages.orderBy('timestamp', 'desc')
        .orderBy('__name__', 'desc');
      const first = await base.limit(20).get();
      const lastFirst = first.docs[first.docs.length - 1];
      const second = await base.startAfter(
        lastFirst.get('timestamp'), lastFirst.id
      ).limit(20).get();
      const lastSecond = second.docs[second.docs.length - 1];
      const third = await base.startAfter(
        lastSecond.get('timestamp'), lastSecond.id
      ).limit(20).get();

      assert.equal(first.size, 20);
      assert.equal(second.size, 20);
      assert.equal(third.size, 5);
      const actual = [...first.docs, ...second.docs, ...third.docs]
        .map(doc => doc.id);
      assert.deepEqual(actual, [...ids].reverse());
      assert.equal(new Set(actual).size, 45);

      // Mensagem nova não deve alterar o cursor já capturado do histórico.
      await messages.doc('message-999').set({
        timestamp: Timestamp.fromMillis(stamp.toMillis() + 1),
        senderId: 'paging-test',
      });
      const repeatSecond = await base.startAfter(
        lastFirst.get('timestamp'), lastFirst.id
      ).limit(20).get();
      assert.deepEqual(repeatSecond.docs.map(doc => doc.id),
        second.docs.map(doc => doc.id));
    } finally {
      const snapshot = await messages.get();
      const cleanup = db.batch();
      for (const document of snapshot.docs) cleanup.delete(document.ref);
      cleanup.delete(chat);
      await cleanup.commit();
    }
  });

});
