// functions/src/community/community-membership-state.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyExistingCommunityMembershipState,
  normalizePersistedCommunityMembershipStatus,
} from './community-membership-state.policy';

test('distingue membership ausente de documento existente inválido', () => {
  assert.deepEqual(
    classifyExistingCommunityMembershipState(false, undefined),
    { kind: 'absent', status: null }
  );

  for (const rawStatus of [undefined, null, '', 'unknown', 1, {}]) {
    assert.deepEqual(
      classifyExistingCommunityMembershipState(true, rawStatus),
      { kind: 'invalid', status: null }
    );
  }
});

test('preserva somente estados persistidos suportados', () => {
  for (const status of ['active', 'pending', 'blocked', 'left'] as const) {
    assert.equal(normalizePersistedCommunityMembershipStatus(status), status);
    assert.deepEqual(
      classifyExistingCommunityMembershipState(true, status),
      { kind: 'valid', status }
    );
  }
});
