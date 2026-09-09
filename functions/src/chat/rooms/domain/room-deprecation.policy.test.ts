import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ROOM_DEPRECATION_USER_MESSAGE,
  ROOM_PRODUCT_STATE,
  rejectDeprecatedRoomGrowth,
} from './room-deprecation.policy';

test('mantém Salas em compatibilidade e bloqueia crescimento do domínio legado', () => {
  assert.equal(ROOM_PRODUCT_STATE, 'deprecated_compatibility_only');

  for (const operation of [
    'create_room',
    'send_invite',
    'accept_invite',
  ] as const) {
    assert.throws(
      () => rejectDeprecatedRoomGrowth(operation),
      (error: unknown) => {
        const candidate = error as {
          code?: unknown;
          message?: unknown;
          details?: { canonicalCollectiveDomain?: unknown };
        };

        return (
          candidate.code === 'failed-precondition'
          && candidate.message === ROOM_DEPRECATION_USER_MESSAGE
          && candidate.details?.canonicalCollectiveDomain === 'community'
        );
      }
    );
  }
});
