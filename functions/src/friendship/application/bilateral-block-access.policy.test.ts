import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Transaction } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  buildBilateralBlockPaths,
  assertNoActiveBilateralBlockInTransaction,
  isActiveBlockData,
  isBilateralBlockActive,
} from './bilateral-block-access.policy';

describe('bilateral-block-access.policy', () => {
  it('considera bloqueio ativo somente quando isBlocked é true', () => {
    assert.equal(isActiveBlockData({ isBlocked: true }), true);
    assert.equal(isActiveBlockData({ isBlocked: false }), false);
    assert.equal(isActiveBlockData({}), false);
    assert.equal(isActiveBlockData(null), false);
  });

  it('bloqueia a relação quando qualquer direção possui bloqueio ativo', () => {
    assert.equal(isBilateralBlockActive({
      actorBlock: { isBlocked: true },
      targetBlock: { isBlocked: false },
    }), true);

    assert.equal(isBilateralBlockActive({
      actorBlock: { isBlocked: false },
      targetBlock: { isBlocked: true },
    }), true);

    assert.equal(isBilateralBlockActive({
      actorBlock: { isBlocked: false },
      targetBlock: { isBlocked: false },
    }), false);
  });

  it('usa os mesmos documentos canônicos de bloqueio nas duas direções', () => {
    assert.deepEqual(buildBilateralBlockPaths('viewer-1', 'owner-2'), [
      'users/viewer-1/blocks/owner-2',
      'users/owner-2/blocks/viewer-1',
    ]);
  });

  it('barra token anterior após bloqueio em qualquer direção', async () => {
    const [outgoing, incoming] = buildBilateralBlockPaths('viewer-1', 'owner-2');
    for (const blockedPath of [outgoing, incoming]) {
      const reads: string[] = [];
      const transaction = {
        get: async (ref: { path: string }) => {
          reads.push(ref.path);
          return { exists: true, data: () => ({ isBlocked: ref.path === blockedPath }) };
        },
      } as unknown as Transaction;
      await assert.rejects(
        assertNoActiveBilateralBlockInTransaction(
          transaction, 'viewer-1', 'owner-2', 'Vídeo público não encontrado.'
        ),
        (error: unknown) => {
          assert.ok(error instanceof HttpsError);
          assert.equal(error.code, 'not-found');
          return true;
        }
      );
      assert.deepEqual(reads.sort(), [outgoing, incoming].sort());
    }
  });

  it('permite relação não bloqueada com ambas leituras transacionais', async () => {
    const paths = buildBilateralBlockPaths('viewer-1', 'owner-2');
    const reads: string[] = [];
    const transaction = {
      get: async (ref: { path: string }) => {
        reads.push(ref.path);
        return { exists: false, data: () => undefined };
      },
    } as unknown as Transaction;
    await assertNoActiveBilateralBlockInTransaction(
      transaction, 'viewer-1', 'owner-2'
    );
    assert.deepEqual(reads.sort(), [...paths].sort());
  });
});
