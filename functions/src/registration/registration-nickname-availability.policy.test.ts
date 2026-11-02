import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePublicNicknameAvailability as availability } from './registration-nickname-availability.policy';

const valid = {
  key: 'nome_exemplo',
  index: { uid: 'user1', type: 'nickname', value: 'nome_exemplo' },
  owner: {
    uid: 'user1', profileCompleted: true, accountStatus: 'active',
    publicVisibility: 'visible', interactionBlocked: false,
  },
  publicProfile: { uid: 'user1', nicknameNormalized: 'nome_exemplo' },
};
test('only completed public owner is observable as taken', () => {
  assert.equal(availability(valid), 'taken');
});
test('unused and unpublished reservations are indistinguishable', () => {
  assert.equal(availability({ key: 'nome_exemplo' }), 'unconfirmed');
  assert.equal(availability({ ...valid, publicProfile: null }), 'unconfirmed');
  assert.equal(availability({ ...valid, owner: {
    ...valid.owner, profileCompleted: false,
  } }), 'unconfirmed');
});
test('hidden or blocked owner cannot be revealed', () => {
  for (const patch of [
    { publicVisibility: 'hidden' }, { suspended: true },
    { accountLocked: true }, { interactionBlocked: true },
    { loginAllowed: false }, { deletionRequestedAt: 123 },
  ]) assert.equal(availability({
    ...valid, owner: { ...valid.owner, ...patch },
  }), 'unconfirmed');
});
test('forged index, alias and projection mismatch are hidden', () => {
  assert.equal(availability({ ...valid, index: {
    ...valid.index, type: 'email',
  } }), 'unconfirmed');
  assert.equal(availability({ ...valid, index: {
    ...valid.index, uid: '../../bad',
  } }), 'unconfirmed');
  assert.equal(availability({ ...valid, publicProfile: {
    uid: 'another', nicknameNormalized: 'nome_exemplo',
  } }), 'unconfirmed');
});
