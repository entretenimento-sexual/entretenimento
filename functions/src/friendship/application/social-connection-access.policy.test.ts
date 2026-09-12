import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateSocialConnectionAccess } from './social-connection-access.policy';

describe('social connection access policy', () => {
  it('autoriza amizade somente quando as duas arestas existem', () => {
    assert.deepEqual(
      evaluateSocialConnectionAccess({
        actorFriendExists: true,
        targetFriendExists: true,
      }),
      { isFriend: true, isBlocked: false }
    );

    assert.deepEqual(
      evaluateSocialConnectionAccess({
        actorFriendExists: true,
        targetFriendExists: false,
      }),
      { isFriend: false, isBlocked: false }
    );

    assert.deepEqual(
      evaluateSocialConnectionAccess({
        actorFriendExists: false,
        targetFriendExists: true,
      }),
      { isFriend: false, isBlocked: false }
    );
  });

  it('bloqueio bilateral prevalece sobre amizade válida', () => {
    assert.deepEqual(
      evaluateSocialConnectionAccess({
        actorFriendExists: true,
        targetFriendExists: true,
        actorBlock: { isBlocked: true },
      }),
      { isFriend: false, isBlocked: true }
    );

    assert.deepEqual(
      evaluateSocialConnectionAccess({
        actorFriendExists: true,
        targetFriendExists: true,
        targetBlock: { isBlocked: true },
      }),
      { isFriend: false, isBlocked: true }
    );
  });

  it('bloqueio inativo não invalida amizade bilateral', () => {
    assert.deepEqual(
      evaluateSocialConnectionAccess({
        actorFriendExists: true,
        targetFriendExists: true,
        actorBlock: { isBlocked: false },
        targetBlock: { isBlocked: false },
      }),
      { isFriend: true, isBlocked: false }
    );
  });
});
