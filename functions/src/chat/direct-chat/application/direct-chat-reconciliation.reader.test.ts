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


describe('readDirectChatReconciliation — exceptional Firestore reads', () => {
  const participants: [string, string] = ['left', 'right'];
  const pair = buildDirectChatPairIdentity(...participants);

  function setup(options: {
    v2?: unknown; v1?: unknown;
    indexed?: Array<{ id: string; data: Record<string, unknown> }>;
    chats?: Record<string, Record<string, unknown>>;
    failRead?: string;
  }) {
    const reads: string[] = [];
    const indexed = options.indexed ?? [];
    const chats = options.chats ?? {};
    const snapshot = (id: string, data?: Record<string, unknown>) => ({
      id, exists: data !== undefined, data: () => data,
    });
    const firestore = {
      collection: (collection: string) => ({
        doc: (id: string) => ({
          get: async () => {
            const path = `${collection}/${id}`;
            reads.push(path);
            if (options.failRead === path) throw new Error('read failed');
            if (collection === 'chats') return snapshot(id, chats[id]);
            const ref = id === pair.canonicalHash ? options.v2 : options.v1;
            return snapshot(id, ref === undefined
              ? undefined : { chatId: ref });
          },
        }),
        where: (field: string, op: string, value: string) => {
          assert.equal(collection, 'chats');
          assert.deepEqual([field, op, value],
            ['participantsKey', '==', pair.legacyKey]);
          return {
            limit: (count: number) => {
              assert.equal(count, 11);
              return {
                get: async () => {
                  if (options.failRead === 'chats/query') throw new Error('read failed');
                  return {
                    size: indexed.length,
                    docs: indexed.map((doc) => snapshot(doc.id, doc.data)),
                  };
                },
              };
            },
          };
        },
      }),
    } as unknown as Pick<Firestore, 'collection'>;
    return { firestore, reads };
  }

  it('não segue IDs de registry malformados e exige revisão', async () => {
    const { firestore, reads } = setup({ v2: '../wrong', v1: 123 });
    const report = await readDirectChatReconciliation(firestore, participants);
    assert.ok(report.findings.includes('REFERENCE_NOT_VERIFIED'));
    assert.equal(report.requiresManualReview, true);
    assert.equal(reads.length, 4);
    assert.ok(reads.every((path) => !path.includes('../wrong')));
  });

  it('detecta registry v1 apontando para outro par', async () => {
    const { firestore } = setup({
      v1: 'foreign',
      chats: { foreign: { participants: ['other', 'pair'] } },
    });
    const report = await readDirectChatReconciliation(firestore, participants);
    assert.ok(report.findings.includes('LEGACY_REGISTRY_WRONG_PAIR'));
    assert.equal(report.requiresManualReview, true);
  });

  it('distingue registry v1 que aponta para chat ausente', async () => {
    const { firestore } = setup({ v1: 'gone' });
    const report = await readDirectChatReconciliation(firestore, participants);
    assert.ok(report.findings.includes('LEGACY_REGISTRY_MISSING_CHAT'));
    assert.equal(report.requiresManualReview, true);
  });

  it('marca query de onze históricos como truncada, sem conclusão única', async () => {
    const indexed = Array.from({ length: 11 }, (_, index) => ({
      id: `thread-${index}`,
      data: { participants: [...pair.participants], participantsKey: pair.legacyKey },
    }));
    const { firestore, reads } = setup({ indexed });
    const report = await readDirectChatReconciliation(firestore, participants);
    assert.ok(report.findings.includes('SCAN_TRUNCATED'));
    assert.ok(report.findings.includes('MULTIPLE_HISTORIES'));
    assert.ok(!report.findings.includes('SINGLE_ELIGIBLE_HISTORY'));
    assert.equal(report.requiresManualReview, true);
    assert.equal(report.inspectedDocuments, 11);
    assert.equal(reads.length, 4);
  });

  it('propaga falha de consulta sem retornar diagnóstico parcial', async () => {
    const { firestore } = setup({ failRead: 'chats/query' });
    await assert.rejects(
      readDirectChatReconciliation(firestore, participants), /read failed/
    );
  });

  it('propaga falha de leitura pontual sem inventar ausência', async () => {
    const { firestore } = setup({ v2: 'broken', failRead: 'chats/broken' });
    await assert.rejects(
      readDirectChatReconciliation(firestore, participants), /read failed/
    );
  });
});
