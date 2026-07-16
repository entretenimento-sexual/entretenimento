import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assertInteractionAccessData } from './interaction-access.policy';

describe('interaction access policy', () => {
  it('permite conta ativa sem bloqueios', () => {
    assert.doesNotThrow(() => assertInteractionAccessData({
      accountStatus: 'active',
      suspended: false,
      interactionBlocked: false,
      ageReverification: { status: 'VERIFIED' },
    }));
  });

  it('bloqueia conta com interactionBlocked', () => {
    assert.throws(() => assertInteractionAccessData({
      accountStatus: 'active',
      interactionBlocked: true,
    }));
  });

  it('bloqueia estados pendentes de revalidação', () => {
    for (const status of [
      'REQUIRED',
      'SUBMITTED',
      'UNDER_REVIEW',
      'EXPIRED',
    ]) {
      assert.throws(() => assertInteractionAccessData({
        accountStatus: 'active',
        interactionBlocked: false,
        ageReverification: { status },
      }));
    }
  });

  it('bloqueia conta suspensa ou fora do estado ativo', () => {
    assert.throws(() => assertInteractionAccessData({
      accountStatus: 'moderation_suspended',
      suspended: true,
      interactionBlocked: true,
    }));
  });
});
