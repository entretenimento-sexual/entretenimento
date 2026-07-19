import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateAccountDeletionOwnedResources } from './account-deletion-owned-resources.policy';

test('allows deletion when owned rooms are terminal and no community remains', () => {
  const result = evaluateAccountDeletionOwnedResources({
    ownedRoomStatuses: ['closed', 'archived'],
    activeOwnerSlot: false,
    ownedCommunityCount: 0,
  });

  assert.deepEqual(result, {
    allowed: true,
    activeOwnedRoomCount: 0,
    ownedCommunityCount: 0,
  });
});

test('blocks deletion when an owned room is active or has an unknown state', () => {
  const active = evaluateAccountDeletionOwnedResources({
    ownedRoomStatuses: ['closed', 'active'],
  });
  const unknown = evaluateAccountDeletionOwnedResources({
    ownedRoomStatuses: [null],
  });

  assert.equal(active.allowed, false);
  assert.equal(active.activeOwnedRoomCount, 1);
  assert.equal(unknown.allowed, false);
  assert.equal(unknown.activeOwnedRoomCount, 1);
});

test('active owner slot blocks deletion even when room projection is missing', () => {
  const result = evaluateAccountDeletionOwnedResources({
    ownedRoomStatuses: [],
    activeOwnerSlot: true,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.activeOwnedRoomCount, 1);
});

test('community ownership blocks deletion until transfer or archive', () => {
  const result = evaluateAccountDeletionOwnedResources({
    ownedRoomStatuses: ['closed'],
    ownedCommunityCount: 2,
  });

  assert.equal(result.allowed, false);
  assert.equal(result.ownedCommunityCount, 2);
});
