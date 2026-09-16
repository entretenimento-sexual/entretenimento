import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityMemberCountProjection,
  summarizeCommunityMembershipOccupancy,
  summarizeCommunityMembershipOccupancyFromCounts,
} from './community-member-count-reconciliation.policy';

test('deriva ocupação somente de memberships ativos conhecidos', () => {
  assert.deepEqual(
    summarizeCommunityMembershipOccupancy([
      'active',
      'pending',
      'blocked',
      'left',
      'active',
    ]),
    {
      totalCount: 5,
      activeCount: 2,
      invalidStatusCount: 0,
    }
  );
});

test('estado de membership desconhecido bloqueia reparo automático', () => {
  const occupancy = summarizeCommunityMembershipOccupancy([
    'active',
    undefined,
    'removed',
  ]);
  const decision = evaluateCommunityMemberCountProjection(1, occupancy);

  assert.equal(occupancy.activeCount, 1);
  assert.equal(occupancy.invalidStatusCount, 2);
  assert.deepEqual(decision, {
    state: 'membership_state_invalid',
    projectedCount: 1,
    activeCount: 1,
    invalidStatusCount: 2,
    repairable: false,
    needsRepair: false,
  });
});

test('resume agregações sem materializar a subcoleção histórica', () => {
  assert.deepEqual(
    summarizeCommunityMembershipOccupancyFromCounts({
      totalCount: 8,
      activeCount: 3,
      knownStatusCount: 6,
    }),
    {
      totalCount: 8,
      activeCount: 3,
      invalidStatusCount: 2,
    }
  );
});

test('agregações inconsistentes falham fechado', () => {
  const occupancy = summarizeCommunityMembershipOccupancyFromCounts({
    totalCount: 4,
    activeCount: 3,
    knownStatusCount: 2,
  });
  const decision = evaluateCommunityMemberCountProjection(3, occupancy);

  assert.equal(occupancy.invalidStatusCount, 1);
  assert.equal(decision.state, 'membership_state_invalid');
  assert.equal(decision.repairable, false);
});

test('detecta projeção ausente e drift em ambas as direções', () => {
  const occupancy = summarizeCommunityMembershipOccupancy([
    'active',
    'active',
  ]);

  assert.equal(
    evaluateCommunityMemberCountProjection(undefined, occupancy).state,
    'projection_invalid'
  );
  assert.equal(
    evaluateCommunityMemberCountProjection(1, occupancy).state,
    'drift'
  );
  assert.equal(
    evaluateCommunityMemberCountProjection(3, occupancy).state,
    'drift'
  );
  assert.equal(
    evaluateCommunityMemberCountProjection(2, occupancy).state,
    'consistent'
  );
});

test('zero membros ativos é uma ocupação válida quando não há corrupção', () => {
  const occupancy = summarizeCommunityMembershipOccupancy([
    'left',
    'blocked',
  ]);
  const decision = evaluateCommunityMemberCountProjection(1, occupancy);

  assert.equal(decision.state, 'drift');
  assert.equal(decision.activeCount, 0);
  assert.equal(decision.repairable, true);
  assert.equal(decision.needsRepair, true);
});
