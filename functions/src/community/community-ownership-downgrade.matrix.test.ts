import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityCapacity,
  type CommunityCapacitySponsorRole,
} from './community-capacity.policy';
import {
  evaluateCommunityOwnershipTransfer,
  type CommunityOwnershipMembershipRole,
  type CommunityOwnershipStatus,
} from './community-ownership-lifecycle.policy';

const TRANSFER_BASE = Object.freeze({
  sourceType: 'community' as const,
  communityStatus: 'active' as const,
  actorUid: 'owner-current',
  targetUid: 'owner-next',
  actorStatus: 'active' as const,
  actorRole: 'owner' as const,
  targetStatus: 'active' as const,
  targetRole: 'member' as const,
  targetAccountEligible: true,
  activeOwnerCount: 1,
});

function capacityFor(role: CommunityCapacitySponsorRole, memberCount = 300) {
  return evaluateCommunityCapacity({
    rawCommunity: {
      source: { type: 'community' },
      capacity: { memberLimit: 500 },
      metrics: { memberCount },
    },
    sponsorRole: role,
  });
}

test('matriz de transferência aceita todos os papéis elegíveis em active e paused', () => {
  const statuses: readonly CommunityOwnershipStatus[] = ['active', 'paused'];
  const targetRoles: readonly CommunityOwnershipMembershipRole[] = [
    'admin',
    'moderator',
    'member',
  ];

  for (const communityStatus of statuses) {
    for (const targetRole of targetRoles) {
      const decision = evaluateCommunityOwnershipTransfer({
        ...TRANSFER_BASE,
        communityStatus,
        targetRole,
      });

      assert.equal(decision.allowed, true, `${communityStatus}/${targetRole}`);
      assert.equal(decision.denialReason, null, `${communityStatus}/${targetRole}`);
      assert.equal(decision.actorNextRole, 'member', `${communityStatus}/${targetRole}`);
      assert.equal(decision.targetNextRole, 'owner', `${communityStatus}/${targetRole}`);
    }
  }
});

test('transferência nunca remove o proprietário anterior: ele permanece membro', () => {
  const decision = evaluateCommunityOwnershipTransfer(TRANSFER_BASE);

  assert.equal(decision.allowed, true);
  assert.equal(decision.actorNextRole, 'member');
  assert.equal(decision.targetNextRole, 'owner');
});

test('plano do novo owner não decide a transferência; decide somente crescimento posterior', () => {
  const transfer = evaluateCommunityOwnershipTransfer(TRANSFER_BASE);
  assert.equal(transfer.allowed, true);

  const matrix: ReadonlyArray<{
    role: CommunityCapacitySponsorRole;
    effectiveLimit: number;
    acceptingNewMembers: boolean;
  }> = [
    { role: 'vip', effectiveLimit: 500, acceptingNewMembers: true },
    { role: 'premium', effectiveLimit: 250, acceptingNewMembers: false },
    { role: 'basic', effectiveLimit: 100, acceptingNewMembers: false },
    { role: 'free', effectiveLimit: 0, acceptingNewMembers: false },
  ];

  for (const entry of matrix) {
    const capacity = capacityFor(entry.role);

    assert.equal(transfer.actorNextRole, 'member', entry.role);
    assert.equal(transfer.targetNextRole, 'owner', entry.role);
    assert.equal(capacity.configuredLimit, 500, entry.role);
    assert.equal(capacity.memberCount, 300, entry.role);
    assert.equal(capacity.effectiveLimit, entry.effectiveLimit, entry.role);
    assert.equal(
      capacity.acceptingNewMembers,
      entry.acceptingNewMembers,
      entry.role
    );
  }
});

test('transferência para conta elegível sem plano pago não cria comunidade órfã', () => {
  const transfer = evaluateCommunityOwnershipTransfer(TRANSFER_BASE);
  const freeCapacity = capacityFor('free', 75);

  assert.equal(transfer.allowed, true);
  assert.equal(transfer.actorNextRole, 'member');
  assert.equal(transfer.targetNextRole, 'owner');
  assert.equal(freeCapacity.memberCount, 75);
  assert.equal(freeCapacity.effectiveLimit, 0);
  assert.equal(freeCapacity.acceptingNewMembers, false);
  assert.equal(freeCapacity.restrictedByOwnerPlan, true);
});

test('upgrade posterior reabre crescimento sem alterar configuração ou memberships', () => {
  const free = capacityFor('free', 75);
  const basic = capacityFor('basic', 75);
  const vip = capacityFor('vip', 75);

  assert.equal(free.memberCount, 75);
  assert.equal(basic.memberCount, 75);
  assert.equal(vip.memberCount, 75);
  assert.equal(free.configuredLimit, 500);
  assert.equal(basic.configuredLimit, 500);
  assert.equal(vip.configuredLimit, 500);

  assert.equal(free.acceptingNewMembers, false);
  assert.equal(basic.acceptingNewMembers, true);
  assert.equal(vip.acceptingNewMembers, true);
});

test('owner inconsistente bloqueia transferência antes de qualquer troca de papéis', () => {
  for (const activeOwnerCount of [0, 2, 3, -1]) {
    const decision = evaluateCommunityOwnershipTransfer({
      ...TRANSFER_BASE,
      activeOwnerCount,
    });

    assert.equal(decision.allowed, false, String(activeOwnerCount));
    assert.equal(decision.denialReason, 'ownership_inconsistent');
    assert.equal(decision.actorNextRole, null);
    assert.equal(decision.targetNextRole, null);
  }
});

test('alvo não elegível nunca recebe propriedade mesmo que seu plano comporte a comunidade', () => {
  const decision = evaluateCommunityOwnershipTransfer({
    ...TRANSFER_BASE,
    targetAccountEligible: false,
  });
  const hypotheticalVipCapacity = capacityFor('vip');

  assert.equal(hypotheticalVipCapacity.effectiveLimit, 500);
  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'target_account_ineligible');
  assert.equal(decision.targetNextRole, null);
});
