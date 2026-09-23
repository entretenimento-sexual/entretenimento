import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityOwnerSuccession,
  type CommunityOwnerSuccessionCandidate,
} from './community-owner-succession.policy';

const READY: CommunityOwnerSuccessionCandidate = Object.freeze({
  explicitlyDesignated: true,
  explicitlyAccepted: true,
  membershipActive: true,
  accountEligible: true,
  ownershipEntitlementEligible: true,
  ownershipQuotaAvailable: true,
  ownershipCapacityCompatible: true,
});

test('sucessão terminal só transfere com designação e aceite explícitos', () => {
  assert.deepEqual(
    evaluateCommunityOwnerSuccession({
      trigger: 'owner_terminally_unavailable',
      candidate: READY,
      resolutionWindowExpired: false,
    }),
    {
      state: 'transfer_ready',
      transferAllowed: true,
      archiveRequired: false,
      reason: null,
    }
  );
});

test('não transforma cargo ou elegibilidade em herança automática', () => {
  for (const candidate of [
    { ...READY, explicitlyDesignated: false },
    { ...READY, explicitlyAccepted: false },
    { ...READY, membershipActive: false },
    { ...READY, accountEligible: false },
    { ...READY, ownershipEntitlementEligible: false },
    { ...READY, ownershipQuotaAvailable: false },
    { ...READY, ownershipCapacityCompatible: false },
  ]) {
    const decision = evaluateCommunityOwnerSuccession({
      trigger: 'confirmed_abandonment',
      candidate,
      resolutionWindowExpired: false,
    });

    assert.equal(decision.state, 'awaiting_resolution');
    assert.equal(decision.transferAllowed, false);
    assert.equal(decision.archiveRequired, false);
  }
});

test('sem sucessor aceito ao fim da janela, arquiva em vez de herdar', () => {
  const decision = evaluateCommunityOwnerSuccession({
    trigger: 'owner_terminally_unavailable',
    candidate: null,
    resolutionWindowExpired: true,
  });

  assert.deepEqual(decision, {
    state: 'archive_required',
    transferAllowed: false,
    archiveRequired: true,
    reason: 'succession_window_expired',
  });
});
