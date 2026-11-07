import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasLegacyPrivateDiscoveryFields,
  isLegacyOwnerRemovalInProgress,
  mustHoldLegacyPublicProfileMutation,
} from './legacy-public-profile-preservation.policy';
import { PRIVATE_DISCOVERY_INTEREST_FIELDS } from './public-profile-discovery-projection';

const active = Object.freeze({ accountStatus: 'active', publicVisibility: 'visible' });

test('all canonical private fields are detected, including empty and null keys', () => {
  assert.equal(PRIVATE_DISCOVERY_INTEREST_FIELDS.length, 21);
  for (const field of PRIVATE_DISCOVERY_INTEREST_FIELDS) {
    assert.equal(hasLegacyPrivateDiscoveryFields({ [field]: null }), true, field);
    assert.equal(hasLegacyPrivateDiscoveryFields({ [field]: [] }), true, field);
    assert.equal(mustHoldLegacyPublicProfileMutation(active, { [field]: [] }), true, field);
  }
});

test('clean public cards and invalid values are not incorrectly held', () => {
  for (const value of [null, undefined, [], 'text', 4, {}, { nickname: 'public' }]) {
    assert.equal(hasLegacyPrivateDiscoveryFields(value), false);
    assert.equal(mustHoldLegacyPublicProfileMutation(active, value), false);
  }
  const inherited = Object.create({ interestedInGenders: ['SECRET'] });
  inherited.nickname = 'public';
  assert.equal(hasLegacyPrivateDiscoveryFields(inherited), false);
});

test('active, hidden, blocked and suspended accounts retain residual private fields', () => {
  const sensitive = { interestedInOrientations: ['SECRET'] };
  for (const owner of [
    active,
    { ...active, publicVisibility: 'hidden' },
    { ...active, interactionBlocked: true },
    { accountStatus: 'moderation_suspended', suspended: true },
    { accountStatus: 'active', accountLocked: true },
  ]) {
    assert.equal(isLegacyOwnerRemovalInProgress(owner), false);
    assert.equal(mustHoldLegacyPublicProfileMutation(owner, sensitive), true);
  }
});

test('account deletion markers do not impede legitimate purge', () => {
  const sensitive = { interestedInGenders: ['SECRET'] };
  for (const owner of [
    null, undefined, { accountStatus: 'deleted' },
    { accountStatus: 'deleting' }, { accountStatus: 'pending_deletion' },
    { accountStatus: 'purging' },
    { accountStatus: 'active', deletionRequestedAt: 1 },
    { accountStatus: 'active', deletedAt: 1 },
    { accountStatus: 'active', purgeStartedAt: 1 },
    { accountStatus: 'active', purgeLeaseOwner: 'operator' },
  ]) {
    assert.equal(isLegacyOwnerRemovalInProgress(owner), true);
    assert.equal(mustHoldLegacyPublicProfileMutation(owner, sensitive), false);
  }
});

test('no caller-provided authorization, reviewer flag or recovery document bypasses hold', () => {
  const sensitive = { interestedInGenders: ['SECRET'] };
  for (const owner of [
    { ...active, approvedForRecovery: true },
    { ...active, privateRecoveryWritten: true },
    { ...active, admin: true },
  ]) assert.equal(mustHoldLegacyPublicProfileMutation(owner, sensitive), true);
});
