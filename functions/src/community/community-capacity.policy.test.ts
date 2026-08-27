import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityCapacity,
  resolveCommunityCreationCapability,
  resolveCommunityMemberLimitOptions,
  type CommunityCapacitySponsorRole,
  type PersonalCommunitySponsorRole,
} from './community-capacity.policy';

function community(input: {
  memberLimit?: number;
  memberCount?: unknown;
  sourceType?: 'community' | 'venue';
} = {}) {
  return {
    source: { type: input.sourceType ?? 'community' },
    capacity: { memberLimit: input.memberLimit ?? 500 },
    metrics: { memberCount: input.memberCount ?? 80 },
  };
}

test('matriz de criação preserva participação gratuita e monetiza somente criação', () => {
  const matrix: ReadonlyArray<{
    role: PersonalCommunitySponsorRole;
    ownedBeforeLimit: number;
    ownedAtLimit: number | null;
    memberLimit: number;
    allowedLimits: readonly number[];
  }> = [
    {
      role: 'free',
      ownedBeforeLimit: 0,
      ownedAtLimit: 0,
      memberLimit: 0,
      allowedLimits: [],
    },
    {
      role: 'basic',
      ownedBeforeLimit: 0,
      ownedAtLimit: 1,
      memberLimit: 100,
      allowedLimits: [25, 50, 100],
    },
    {
      role: 'premium',
      ownedBeforeLimit: 2,
      ownedAtLimit: 3,
      memberLimit: 250,
      allowedLimits: [25, 50, 100, 250],
    },
    {
      role: 'vip',
      ownedBeforeLimit: 4,
      ownedAtLimit: 5,
      memberLimit: 500,
      allowedLimits: [25, 50, 100, 250, 500],
    },
    {
      role: 'admin',
      ownedBeforeLimit: 999,
      ownedAtLimit: null,
      memberLimit: 1_000,
      allowedLimits: [25, 50, 100, 250, 500, 1_000],
    },
  ];

  for (const entry of matrix) {
    const beforeLimit = resolveCommunityCreationCapability({
      sponsorRole: entry.role,
      currentOwnedCommunities: entry.ownedBeforeLimit,
    });

    assert.equal(beforeLimit.memberLimit, entry.memberLimit, entry.role);
    assert.deepEqual(beforeLimit.allowedMemberLimits, entry.allowedLimits, entry.role);
    assert.deepEqual(
      resolveCommunityMemberLimitOptions(entry.role),
      entry.allowedLimits,
      entry.role
    );

    if (entry.role === 'free') {
      assert.equal(beforeLimit.canCreate, false);
      assert.equal(beforeLimit.reason, 'subscription_required');
      continue;
    }

    assert.equal(beforeLimit.canCreate, true, entry.role);
    assert.equal(beforeLimit.reason, null, entry.role);

    if (entry.ownedAtLimit !== null) {
      const atLimit = resolveCommunityCreationCapability({
        sponsorRole: entry.role,
        currentOwnedCommunities: entry.ownedAtLimit,
      });
      assert.equal(atLimit.canCreate, false, entry.role);
      assert.equal(atLimit.reason, 'limit_reached', entry.role);
    }
  }
});

test('downgrade altera apenas o teto efetivo e nunca reescreve a contagem existente', () => {
  const currentMembers = 300;
  const rawCommunity = community({ memberLimit: 500, memberCount: currentMembers });
  const expected: ReadonlyArray<{
    role: CommunityCapacitySponsorRole;
    effectiveLimit: number;
    acceptingNewMembers: boolean;
    restrictedByOwnerPlan: boolean;
  }> = [
    {
      role: 'vip',
      effectiveLimit: 500,
      acceptingNewMembers: true,
      restrictedByOwnerPlan: false,
    },
    {
      role: 'premium',
      effectiveLimit: 250,
      acceptingNewMembers: false,
      restrictedByOwnerPlan: true,
    },
    {
      role: 'basic',
      effectiveLimit: 100,
      acceptingNewMembers: false,
      restrictedByOwnerPlan: true,
    },
    {
      role: 'free',
      effectiveLimit: 0,
      acceptingNewMembers: false,
      restrictedByOwnerPlan: true,
    },
  ];

  for (const entry of expected) {
    const state = evaluateCommunityCapacity({
      rawCommunity,
      sponsorRole: entry.role,
    });

    assert.equal(state.configuredLimit, 500, entry.role);
    assert.equal(state.memberCount, currentMembers, entry.role);
    assert.equal(state.effectiveLimit, entry.effectiveLimit, entry.role);
    assert.equal(state.acceptingNewMembers, entry.acceptingNewMembers, entry.role);
    assert.equal(state.restrictedByOwnerPlan, entry.restrictedByOwnerPlan, entry.role);
    assert.equal(state.atCapacity, !entry.acceptingNewMembers, entry.role);
  }

  assert.equal(rawCommunity.capacity.memberLimit, 500);
  assert.equal(rawCommunity.metrics.memberCount, currentMembers);
});

test('downgrade abaixo da população atual congela crescimento sem expulsar membros', () => {
  for (const memberCount of [101, 250, 501]) {
    const state = evaluateCommunityCapacity({
      rawCommunity: community({ memberLimit: 500, memberCount }),
      sponsorRole: 'basic',
    });

    assert.equal(state.effectiveLimit, 100);
    assert.equal(state.memberCount, memberCount);
    assert.equal(state.acceptingNewMembers, false);
    assert.equal(state.restrictedByOwnerPlan, true);
  }
});

test('limite configurado menor que o plano continua pertencendo à Comunidade', () => {
  const state = evaluateCommunityCapacity({
    rawCommunity: community({ memberLimit: 50, memberCount: 49 }),
    sponsorRole: 'vip',
  });

  assert.equal(state.configuredLimit, 50);
  assert.equal(state.ownerPlanLimit, 500);
  assert.equal(state.effectiveLimit, 50);
  assert.equal(state.restrictedByOwnerPlan, false);
  assert.equal(state.acceptingNewMembers, true);
});

test('contagem desconhecida falha fechado para novas entradas sem inventar zero', () => {
  for (const memberCount of [undefined, null, '80', -1, Number.NaN]) {
    const state = evaluateCommunityCapacity({
      rawCommunity: {
        source: { type: 'community' },
        capacity: { memberLimit: 100 },
        metrics: memberCount === undefined ? {} : { memberCount },
      },
      sponsorRole: 'basic',
    });

    assert.equal(state.memberCount, null);
    assert.equal(state.acceptingNewMembers, false);
    assert.equal(state.atCapacity, true);
  }
});

test('Local oficial mantém capacidade própria independente de plano pessoal', () => {
  const rawVenue = community({
    sourceType: 'venue',
    memberLimit: 1_000,
    memberCount: 700,
  });
  const state = evaluateCommunityCapacity({
    rawCommunity: rawVenue,
    sponsorRole: 'official_space',
  });

  assert.equal(state.configuredLimit, 1_000);
  assert.equal(state.ownerPlanLimit, 1_000);
  assert.equal(state.effectiveLimit, 1_000);
  assert.equal(state.memberCount, 700);
  assert.equal(state.acceptingNewMembers, true);
  assert.equal(state.restrictedByOwnerPlan, false);
});
