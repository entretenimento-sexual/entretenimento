// functions/src/community/community-admission-operational.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import { isCommunityAdmissionOperational } from './community-admission-operational.policy';

test('permite admissão somente em Comunidade ativa com moderação ativa', () => {
  assert.equal(
    isCommunityAdmissionOperational({
      status: 'active',
      moderation: { state: 'active' },
    }),
    true
  );

  for (const status of [
    'paused',
    'dormant',
    'archived',
    'scheduled_for_deletion',
    undefined,
  ]) {
    assert.equal(
      isCommunityAdmissionOperational({
        status,
        moderation: { state: 'active' },
      }),
      false
    );
  }

  for (const moderationState of ['paused', 'blocked', undefined]) {
    assert.equal(
      isCommunityAdmissionOperational({
        status: 'active',
        moderation: { state: moderationState },
      }),
      false
    );
  }
});
