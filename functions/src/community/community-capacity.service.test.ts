import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityCapacityForOwner,
  resolveCommunityCapacityOwnerUid,
} from './community-capacity.service';

const NOW = 1_800_000_000_000;

type PaidRole = 'basic' | 'premium' | 'vip';

function community(input: {
  ownerUid?: string;
  memberLimit?: number;
  memberCount?: number;
  sourceType?: 'community' | 'venue';
} = {}) {
  return {
    ownerUid: input.ownerUid ?? 'owner-1',
    source: { type: input.sourceType ?? 'community' },
    capacity: { memberLimit: input.memberLimit ?? 500 },
    metrics: { memberCount: input.memberCount ?? 180 },
  };
}

function entitlement(
  buyerUid: string,
  role: PaidRole,
  overrides: Record<string, unknown> = {}
) {
  return {
    buyerUid,
    scope: 'platform_subscription',
    grantedRole: role,
    planKey: role,
    active: true,
    startsAt: NOW - 60_000,
    endsAt: NOW + 60_000,
    updatedAt: NOW - 30_000,
    ...overrides,
  };
}

test('resolve capacidade pelo entitlement canônico do owner atual', () => {
  const matrix = [
    { role: 'basic' as const, expectedLimit: 100 },
    { role: 'premium' as const, expectedLimit: 250 },
    { role: 'vip' as const, expectedLimit: 500 },
  ];

  for (const entry of matrix) {
    const state = evaluateCommunityCapacityForOwner({
      rawCommunity: community({ ownerUid: 'owner-1', memberCount: 80 }),
      rawOwnerEntitlement: entitlement('owner-1', entry.role),
      rawOwnerUser: { role: 'user' },
      now: NOW,
    });

    assert.ok(state, entry.role);
    assert.equal(state.ownerPlanLimit, entry.expectedLimit, entry.role);
    assert.equal(state.effectiveLimit, entry.expectedLimit, entry.role);
    assert.equal(state.memberCount, 80, entry.role);
  }
});

test('entitlement vencido, inativo ou de outro usuário vira Free sem remover membros', () => {
  const invalidEntitlements = [
    entitlement('owner-1', 'vip', { endsAt: NOW }),
    entitlement('owner-1', 'vip', { active: false }),
    entitlement('other-owner', 'vip'),
  ];

  for (const rawOwnerEntitlement of invalidEntitlements) {
    const state = evaluateCommunityCapacityForOwner({
      rawCommunity: community({
        ownerUid: 'owner-1',
        memberLimit: 500,
        memberCount: 320,
      }),
      rawOwnerEntitlement,
      rawOwnerUser: { role: 'user' },
      now: NOW,
    });

    assert.ok(state);
    assert.equal(state.ownerPlanLimit, 0);
    assert.equal(state.effectiveLimit, 0);
    assert.equal(state.memberCount, 320);
    assert.equal(state.acceptingNewMembers, false);
    assert.equal(state.restrictedByOwnerPlan, true);
  }
});

test('troca de owner faz capacidade seguir o novo entitlement, não o proprietário anterior', () => {
  const beforeTransfer = evaluateCommunityCapacityForOwner({
    rawCommunity: community({
      ownerUid: 'owner-vip',
      memberLimit: 500,
      memberCount: 180,
    }),
    rawOwnerEntitlement: entitlement('owner-vip', 'vip'),
    rawOwnerUser: { role: 'user' },
    now: NOW,
  });
  const afterTransfer = evaluateCommunityCapacityForOwner({
    rawCommunity: community({
      ownerUid: 'owner-basic',
      memberLimit: 500,
      memberCount: 180,
    }),
    rawOwnerEntitlement: entitlement('owner-basic', 'basic'),
    rawOwnerUser: { role: 'user' },
    now: NOW,
  });

  assert.ok(beforeTransfer);
  assert.ok(afterTransfer);
  assert.equal(beforeTransfer.effectiveLimit, 500);
  assert.equal(beforeTransfer.acceptingNewMembers, true);
  assert.equal(afterTransfer.effectiveLimit, 100);
  assert.equal(afterTransfer.memberCount, 180);
  assert.equal(afterTransfer.acceptingNewMembers, false);
  assert.equal(afterTransfer.restrictedByOwnerPlan, true);
});

test('admin mantém teto administrativo mesmo sem entitlement pago', () => {
  const state = evaluateCommunityCapacityForOwner({
    rawCommunity: community({
      ownerUid: 'admin-1',
      memberLimit: 1_000,
      memberCount: 999,
    }),
    rawOwnerEntitlement: null,
    rawOwnerUser: { role: 'admin' },
    now: NOW,
  });

  assert.ok(state);
  assert.equal(state.ownerPlanLimit, 1_000);
  assert.equal(state.effectiveLimit, 1_000);
  assert.equal(state.acceptingNewMembers, true);
});

test('Local oficial ignora assinatura pessoal e usa capacidade institucional', () => {
  const state = evaluateCommunityCapacityForOwner({
    rawCommunity: community({
      ownerUid: 'venue-owner',
      sourceType: 'venue',
      memberLimit: 1_000,
      memberCount: 900,
    }),
    rawOwnerEntitlement: null,
    rawOwnerUser: null,
    now: NOW,
  });

  assert.ok(state);
  assert.equal(state.ownerPlanLimit, 1_000);
  assert.equal(state.effectiveLimit, 1_000);
  assert.equal(state.memberCount, 900);
  assert.equal(state.acceptingNewMembers, true);
});

test('ownerUid ausente ou inseguro falha fechado em Comunidade pessoal', () => {
  assert.equal(resolveCommunityCapacityOwnerUid({ ownerUid: '../owner' }), null);
  assert.equal(resolveCommunityCapacityOwnerUid({ ownerUid: '' }), null);
  assert.equal(
    evaluateCommunityCapacityForOwner({
      rawCommunity: {
        source: { type: 'community' },
        capacity: { memberLimit: 100 },
        metrics: { memberCount: 10 },
      },
      rawOwnerEntitlement: entitlement('owner-1', 'basic'),
      rawOwnerUser: { role: 'user' },
      now: NOW,
    }),
    null
  );
});
