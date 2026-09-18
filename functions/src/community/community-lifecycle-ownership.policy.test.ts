// functions/src/community/community-lifecycle-ownership.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CommunityLifecycleDecision,
  CommunityLifecycleMembershipOccupancy,
} from './community-lifecycle.policy';
import { resolveCommunityLifecycleOwnership } from './community-lifecycle-ownership.policy';

function decision(
  overrides: Partial<CommunityLifecycleDecision> = {}
): CommunityLifecycleDecision {
  return {
    currentStatus: 'archived',
    nextStatus: 'scheduled_for_deletion',
    changed: true,
    reason: 'empty_archive_expired',
    shouldHideFromDiscovery: true,
    deletionEligibleAt: 123,
    ...overrides,
  };
}

function resolve(
  rawCommunity: unknown,
  occupancy: CommunityLifecycleMembershipOccupancy,
  ownerMembershipRead: { exists: boolean; data: unknown } | null = null,
  lifecycleDecision: CommunityLifecycleDecision = decision()
) {
  return resolveCommunityLifecycleOwnership(
    rawCommunity,
    lifecycleDecision,
    occupancy,
    ownerMembershipRead
  );
}

test('não toca ownership fora de transição destrutiva com vazio canônico', () => {
  assert.deepEqual(
    resolve(
      { ownerUid: 'owner-1' },
      'nonempty',
      null
    ),
    { state: 'not_required', ownerUid: null }
  );
  assert.deepEqual(
    resolve(
      { ownerUid: 'owner-1' },
      'empty',
      null,
      decision({ changed: false, reason: 'no_transition' })
    ),
    { state: 'not_required', ownerUid: null }
  );
});

test('ownerUid já ausente segue sem mutação adicional', () => {
  assert.deepEqual(resolve({}, 'empty'), {
    state: 'already_released',
    ownerUid: null,
  });
});

test('ownerUid válido exige leitura canônica da membership antes de liberar', () => {
  assert.deepEqual(resolve({ ownerUid: 'owner-1' }, 'empty'), {
    state: 'needs_owner_membership_read',
    ownerUid: 'owner-1',
  });
});

test('membership ausente ou terminal libera ownerUid', () => {
  assert.deepEqual(
    resolve(
      { ownerUid: 'owner-1' },
      'empty',
      { exists: false, data: null }
    ),
    { state: 'release', ownerUid: 'owner-1' }
  );

  for (const status of ['left', 'blocked', 'pending'] as const) {
    assert.deepEqual(
      resolve(
        { ownerUid: 'owner-1' },
        'empty',
        { exists: true, data: { status } }
      ),
      { state: 'release', ownerUid: 'owner-1' }
    );
  }
});

test('ownerUid ou membership corrompidos falham fechado', () => {
  assert.deepEqual(resolve({ ownerUid: 'owner/1' }, 'empty'), {
    state: 'inconsistent',
    ownerUid: null,
    reason: 'owner_pointer_invalid',
  });

  assert.deepEqual(
    resolve(
      { ownerUid: 'owner-1' },
      'empty',
      { exists: true, data: { status: 'unknown' } }
    ),
    {
      state: 'inconsistent',
      ownerUid: 'owner-1',
      reason: 'owner_membership_invalid',
    }
  );
});

test('owner ainda ativo nunca é liberado por inferência', () => {
  assert.deepEqual(
    resolve(
      { ownerUid: 'owner-1' },
      'empty',
      { exists: true, data: { status: 'active' } }
    ),
    {
      state: 'inconsistent',
      ownerUid: 'owner-1',
      reason: 'owner_membership_active',
    }
  );
});

test('active vazio também usa a mesma reconciliação antes de arquivar', () => {
  const result = resolve(
    { ownerUid: 'owner-1' },
    'empty',
    { exists: true, data: { status: 'left' } },
    decision({
      currentStatus: 'active',
      nextStatus: 'archived',
      reason: 'empty_and_inactive',
      deletionEligibleAt: null,
    })
  );

  assert.deepEqual(result, { state: 'release', ownerUid: 'owner-1' });
});
