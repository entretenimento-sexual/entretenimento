import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { buildDirectChatPairIdentity } from '../domain/direct-chat.policy';
import { readDirectChatReconciliation } from './direct-chat-reconciliation.reader';

describe('readDirectChatReconciliation — bounded read-only adapter', () => {
  const participants: [string, string] = ['left', 'right'];
  const pair = buildDirectChatPairIdentity(...participants);

  function harness(options: { linked?: string; exists?: boolean } = {}) {
    const reads: string[] = [];
    const docs = new Map<string, Record<string, unknown>>();
    if (options.exists && options.linked) {
      docs.set(options.linked, { participants: pair.participants });
    }
    const snapshot = (id: string) => ({
      id, exists: docs.has(id), data: () => docs.get(id),
    });
    const firestore = {
      collection: (name: string) => ({
        doc: (id: string) => ({
          get: async () => {
            reads.push(`${name}/${id}`);
            if (name === 'direct_chat_pairs' && id === pair.canonicalHash
              && options.linked) {
              return { id, exists: true, data: () => ({ chatId: options.linked }) };
            }
            return snapshot(id);
          },
        }),
        where: (field: string, operator: string, value: string) => {
          assert.equal(name, 'chats');
          assert.equal(field, 'participantsKey');
          assert.equal(operator, '==');
          assert.equal(value, pair.legacyKey);
          return {
            limit: (count: number) => {
              assert.equal(count, 11);
              return { get: async () => ({ size: 0, docs: [] }) };
            },
          };
        },
      }),
    } as unknown as Pick<Firestore, 'collection'>;
    return { firestore, reads };
  }

  it('verifica referência inexistente sem operações de escrita', async () => {
    const { firestore, reads } = harness({ linked: 'missing' });
    const report = await readDirectChatReconciliation(firestore, participants);
    assert.ok(report.findings.includes('CANONICAL_REGISTRY_MISSING_CHAT'));
    assert.equal(report.requiresManualReview, true);
    assert.equal(reads.filter((path) => path === 'chats/missing').length, 1);
    assert.equal(report.boundedQuery, true);
  });

  it('inspeciona referência existente sem reportar ausência falsa', async () => {
    const { firestore } = harness({ linked: 'old-thread', exists: true });
    const report = await readDirectChatReconciliation(firestore, participants);
    assert.deepEqual(report.eligibleChatIds, ['old-thread']);
    assert.ok(!report.findings.includes('CANONICAL_REGISTRY_MISSING_CHAT'));
    assert.equal(report.requiresManualReview, false);
  });
});
