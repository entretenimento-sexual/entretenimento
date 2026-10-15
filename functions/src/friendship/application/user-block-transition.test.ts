import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolveUserBlockTransition,
  isBilateralChatAvailable,
  isBilateralPublicMediaAvailable,
} from './user-block-transition';

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


describe('direct chat access projection', () => {
  it('nega disponibilidade quando qualquer lado mantém bloqueio', () => {
    assert.equal(isBilateralChatAvailable(true, false), false);
    assert.equal(isBilateralChatAvailable(false, true), false);
    assert.equal(isBilateralChatAvailable(true, true), false);
  });

  it('restaura disponibilidade somente após ambos os bloqueios cessarem', () => {
    assert.equal(isBilateralChatAvailable(false, false), true);
    assert.equal(isBilateralChatAvailable(false, undefined), true);
  });
});


describe('public media bilateral availability projection', () => {
  it('blocks either direction regardless of friendship', () => {
    assert.equal(isBilateralPublicMediaAvailable(true, false), false);
    assert.equal(isBilateralPublicMediaAvailable(false, true), false);
    assert.equal(isBilateralPublicMediaAvailable(true, true), false);
  });

  it('restores only if neither direction blocks', () => {
    assert.equal(isBilateralPublicMediaAvailable(false, false), true);
    assert.equal(isBilateralPublicMediaAvailable(false, undefined), true);
    assert.equal(isBilateralPublicMediaAvailable(undefined, true), false);
  });
});
