// functions/src/community/community-capacity-regularization.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyCommunityCapacityRegularizationGate,
  evaluateCommunityCapacityRegularization,
} from './community-capacity-regularization.policy';
import { evaluateCommunityCapacity } from './community-capacity.policy';
import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';

const NOW = 1_800_000_000_000;
const GRACE_MS =
  COMMUNITY_PRODUCT_LIMITS.capacityRegularization.gracePeriodDays
  * 24 * 60 * 60 * 1_000;

test('não cria regularização quando ownership e capacidade cabem no plano', () => {
  assert.equal(
    evaluateCommunityCapacityRegularization({
      rawCommunity: { capacity: { memberLimit: 100 } },
      ownerUid: 'owner-1',
      sponsorRole: 'basic',
      currentOwnedCommunities: 1,
      maxOwnedCommunities: 1,
      planMemberLimit: 100,
      now: NOW,
    }),
    null
  );
});

test('abre grace period canônico sem remover membros', () => {
  const result = evaluateCommunityCapacityRegularization({
    rawCommunity: {
      capacity: { memberLimit: 250 },
      metrics: { memberCount: 180 },
    },
    ownerUid: 'owner-1',
    sponsorRole: 'basic',
    currentOwnedCommunities: 3,
    maxOwnedCommunities: 1,
    planMemberLimit: 100,
    now: NOW,
  });

  assert.equal(result?.status, 'grace_period');
  assert.deepEqual(result?.reasons, [
    'capacity_over_plan',
    'owned_community_quota_exceeded',
  ]);
  assert.equal(result?.deadlineAt, NOW + GRACE_MS);
  assert.deepEqual(result?.availableActions, [
    'regularize_plan',
    'transfer_ownership',
    'archive',
  ]);
});

test('preserva o mesmo ciclo e vira action_required após o prazo', () => {
  const first = evaluateCommunityCapacityRegularization({
    rawCommunity: { capacity: { memberLimit: 100 } },
    ownerUid: 'owner-1',
    sponsorRole: 'free',
    currentOwnedCommunities: 1,
    maxOwnedCommunities: 0,
    planMemberLimit: 0,
    now: NOW,
  });
  assert.ok(first);

  const overdue = evaluateCommunityCapacityRegularization({
    rawCommunity: {
      capacity: { memberLimit: 100 },
      capacityRegularization: first,
    },
    ownerUid: 'owner-1',
    sponsorRole: 'free',
    currentOwnedCommunities: 1,
    maxOwnedCommunities: 0,
    planMemberLimit: 0,
    now: NOW + GRACE_MS + 1,
  });

  assert.equal(overdue?.status, 'action_required');
  assert.equal(overdue?.startedAt, NOW);
  assert.equal(overdue?.deadlineAt, NOW + GRACE_MS);
  assert.equal(overdue?.nextEvaluationAt, null);
});

test('deadline vencido pausa novas entradas sem remover memberships', () => {
  const base = evaluateCommunityCapacity({
    rawCommunity: {
      capacity: { memberLimit: 25 },
      metrics: { memberCount: 12 },
    },
    sponsorRole: 'basic',
  });
  const gated = applyCommunityCapacityRegularizationGate(base, {
    capacityRegularization: {
      policyVersion: 1,
      status: 'action_required',
      ownerUid: 'owner-1',
      reasons: ['owned_community_quota_exceeded'],
      sponsorRole: 'basic',
      currentOwnedCommunities: 2,
      maxOwnedCommunities: 1,
      configuredMemberLimit: 25,
      planMemberLimit: 100,
      startedAt: NOW,
      deadlineAt: NOW + GRACE_MS,
      nextEvaluationAt: null,
      availableActions: [
        'regularize_plan',
        'transfer_ownership',
        'archive',
      ],
      updatedAt: NOW + GRACE_MS,
    },
  });

  assert.equal(gated.effectiveLimit, 0);
  assert.equal(gated.acceptingNewMembers, false);
  assert.equal(gated.memberCount, 12);
  assert.equal(
    gated.regularizationReason,
    'owned_community_quota_exceeded'
  );
});
