import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildBilateralBlockPaths,
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
});
