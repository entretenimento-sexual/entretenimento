import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveUserBlockTransition } from './user-block-transition';

describe('user-block-transition', () => {
  it('bloqueia quando o estado atual não está bloqueado', () => {
    assert.deepEqual(resolveUserBlockTransition(false, 'block'), {
      changed: true,
      nextIsBlocked: true,
      status: 'blocked',
    });

    assert.deepEqual(resolveUserBlockTransition(undefined, 'block'), {
      changed: true,
      nextIsBlocked: true,
      status: 'blocked',
    });
  });

  it('não duplica transição ao repetir block', () => {
    assert.deepEqual(resolveUserBlockTransition(true, 'block'), {
      changed: false,
      nextIsBlocked: true,
      status: 'blocked',
    });
  });

  it('desbloqueia apenas quando existe bloqueio ativo', () => {
    assert.deepEqual(resolveUserBlockTransition(true, 'unblock'), {
      changed: true,
      nextIsBlocked: false,
      status: 'unblocked',
    });

    assert.deepEqual(resolveUserBlockTransition(false, 'unblock'), {
      changed: false,
      nextIsBlocked: false,
      status: 'unblocked',
    });

    assert.deepEqual(resolveUserBlockTransition(undefined, 'unblock'), {
      changed: false,
      nextIsBlocked: false,
      status: 'unblocked',
    });
  });
});
