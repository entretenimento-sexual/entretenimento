import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { buildDirectChatPairIdentity } from '../domain/direct-chat.policy';
import { readDirectChatReconciliation } from './direct-chat-reconciliation.reader';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('direct chat reconciliation — Firestore emulator', () => {
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
});
