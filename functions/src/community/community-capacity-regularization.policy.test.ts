import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityCapacityRegularization,
  isCommunityCapacityRegularizationOverdue,
  resolveCapacityRegularizationGracePeriodMs,
  resolveCommunityCapacityRegularizationClockOwnerUid,
  resolveCommunityCapacityRegularizationForViewer,
  sanitizeCommunityCapacityRegularizationForManagement,
} from './community-capacity-regularization.policy';

const NOW = 1_800_000_000_000;

test('abre regularização com prazo configurável sem alterar ownership', () => {
  const result = buildCommunityCapacityRegularization({
    rawExisting: null,
    ownerUid: 'owner-1',
    now: NOW,
    capacity: {
      configuredLimit: 100,
      ownerPlanLimit: 0,
      effectiveLimit: 0,
      memberCount: 80,
      acceptingNewMembers: false,
      restrictedByOwnerPlan: true,
      regularizationRequired: true,
      regularizationReason: 'owner_subscription_required',
      atCapacity: true,
    },
  });

  assert.ok(result);
  assert.equal(result.state, 'capacity_regularization');
  assert.equal(result.phase, 'grace_period');
  assert.equal(result.ownerUid, 'owner-1');
  assert.equal(result.startedAt, NOW);
  assert.equal(
    result.dueAt,
    NOW + resolveCapacityRegularizationGracePeriodMs()
  );
});

test('preserva startedAt no mesmo ciclo e marca overdue pelo relógio', () => {
  const startedAt = NOW - resolveCapacityRegularizationGracePeriodMs();
  const result = buildCommunityCapacityRegularization({
    rawExisting: {
      state: 'capacity_regularization',
      reason: 'capacity_over_plan',
      ownerUid: 'owner-1',
      startedAt,
    },
    ownerUid: 'owner-1',
    now: NOW,
    capacity: {
      configuredLimit: 250,
      ownerPlanLimit: 100,
      effectiveLimit: 100,
      memberCount: 90,
      acceptingNewMembers: true,
      restrictedByOwnerPlan: true,
      regularizationRequired: true,
      regularizationReason: 'capacity_over_plan',
      atCapacity: false,
    },
  });

  assert.ok(result);
  assert.equal(result.startedAt, startedAt);
  assert.equal(result.phase, 'overdue');
  assert.equal(isCommunityCapacityRegularizationOverdue(result, NOW), true);
});

test('encerra regularização quando entitlement volta a suportar a capacidade', () => {
  const result = buildCommunityCapacityRegularization({
    rawExisting: {
      state: 'capacity_regularization',
      reason: 'capacity_over_plan',
      ownerUid: 'owner-1',
      startedAt: NOW - 1_000,
    },
    ownerUid: 'owner-1',
    now: NOW,
    capacity: {
      configuredLimit: 100,
      ownerPlanLimit: 100,
      effectiveLimit: 100,
      memberCount: 80,
      acceptingNewMembers: true,
      restrictedByOwnerPlan: false,
      regularizationRequired: false,
      regularizationReason: null,
      atCapacity: false,
    },
  });

  assert.equal(result, null);
});


test('abre regularização por excesso de ownership mesmo com capacidade compatível', () => {
  const result = buildCommunityCapacityRegularization({
    rawExisting: null,
    ownerUid: 'owner-1',
    reasonOverride: 'ownership_over_plan',
    now: NOW,
    capacity: {
      configuredLimit: 100,
      ownerPlanLimit: 100,
      effectiveLimit: 100,
      memberCount: 40,
      acceptingNewMembers: true,
      restrictedByOwnerPlan: false,
      regularizationRequired: false,
      regularizationReason: null,
      atCapacity: false,
    },
  });

  assert.ok(result);
  assert.equal(result.reason, 'ownership_over_plan');
  assert.equal(result.phase, 'grace_period');
  assert.equal(result.effectiveLimit, 100);
});


test('seleciona owner para reconciliação de relógio somente ao vencer grace period', () => {
  const dueAt = NOW;

  assert.equal(
    resolveCommunityCapacityRegularizationClockOwnerUid({
      state: 'capacity_regularization',
      phase: 'grace_period',
      ownerUid: 'owner-1',
      dueAt,
    }, NOW - 1),
    null
  );

  assert.equal(
    resolveCommunityCapacityRegularizationClockOwnerUid({
      state: 'capacity_regularization',
      phase: 'grace_period',
      ownerUid: 'owner-1',
      dueAt,
    }, NOW),
    'owner-1'
  );

  assert.equal(
    resolveCommunityCapacityRegularizationClockOwnerUid({
      state: 'capacity_regularization',
      phase: 'overdue',
      ownerUid: 'owner-1',
      dueAt,
    }, NOW + 1),
    null
  );

  assert.equal(
    resolveCommunityCapacityRegularizationClockOwnerUid({
      state: 'capacity_regularization',
      phase: 'grace_period',
      ownerUid: '../invalid',
      dueAt,
    }, NOW + 1),
    null
  );
});


test('expõe regularização sanitizada apenas para owner/admin e deriva overdue pelo dueAt', () => {
  const raw = {
    state: 'capacity_regularization',
    phase: 'grace_period',
    reason: 'ownership_over_plan',
    ownerUid: 'owner-sensitive',
    configuredLimit: 100,
    effectiveLimit: 0,
    startedAt: NOW - 2_000,
    dueAt: NOW - 1_000,
    policyVersion: 1,
  };

  assert.deepEqual(
    sanitizeCommunityCapacityRegularizationForManagement(raw, NOW),
    {
      phase: 'overdue',
      reason: 'ownership_over_plan',
      startedAt: NOW - 2_000,
      dueAt: NOW - 1_000,
    }
  );
  assert.deepEqual(
    resolveCommunityCapacityRegularizationForViewer(raw, 'owner', NOW),
    {
      phase: 'overdue',
      reason: 'ownership_over_plan',
      startedAt: NOW - 2_000,
      dueAt: NOW - 1_000,
    }
  );
  assert.notEqual(
    resolveCommunityCapacityRegularizationForViewer(raw, 'admin', NOW),
    null
  );
  assert.equal(
    resolveCommunityCapacityRegularizationForViewer(raw, 'moderator', NOW),
    null
  );
  assert.equal(
    resolveCommunityCapacityRegularizationForViewer(raw, 'member', NOW),
    null
  );
});

test('rejeita projeção de regularização malformada', () => {
  assert.equal(
    sanitizeCommunityCapacityRegularizationForManagement({
      state: 'capacity_regularization',
      reason: 'unknown',
      startedAt: NOW,
      dueAt: NOW + 1_000,
    }, NOW),
    null
  );
  assert.equal(
    sanitizeCommunityCapacityRegularizationForManagement({
      state: 'capacity_regularization',
      reason: 'capacity_over_plan',
      startedAt: NOW,
      dueAt: NOW - 1,
    }, NOW),
    null
  );
});
