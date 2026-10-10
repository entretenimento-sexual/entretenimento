import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { describe, it } from 'node:test';
import { db } from '../../../firebaseApp';
import { buildDirectChatPairIdentity } from '../domain/direct-chat.policy';
import { readDirectChatReconciliation } from './direct-chat-reconciliation.reader';

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

run('direct chat reconciliation — Firestore emulator', () => {
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
