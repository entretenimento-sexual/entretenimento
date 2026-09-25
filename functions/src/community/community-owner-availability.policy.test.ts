import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityOwnerAvailability,
} from './community-owner-availability.policy';

const now = Date.UTC(2026, 8, 24, 12, 0, 0);

test('suspensão pausa Comunidade ativa sem transferir ownership', () => {
  const decision = evaluateCommunityOwnerAvailability({
    ownerUid: 'owner-1',
    accountStatus: 'self_suspended',
    communityStatus: 'active',
    rawHold: null,
    now,
  });

  assert.equal(decision.kind, 'apply');
  if (decision.kind !== 'apply') return;
  assert.equal(decision.nextStatus, 'paused');
  assert.equal(decision.hold.previousStatus, 'active');
  assert.equal(decision.hold.ownerUid, 'owner-1');
});

test('preserva pausa preexistente para não reativar indevidamente', () => {
  const decision = evaluateCommunityOwnerAvailability({
    ownerUid: 'owner-1',
    accountStatus: 'moderation_suspended',
    communityStatus: 'paused',
    rawHold: null,
    now,
  });

  assert.equal(decision.kind, 'apply');
  if (decision.kind !== 'apply') return;
  assert.equal(decision.hold.previousStatus, 'paused');
});

test('reativação restaura somente o status preservado pelo hold', () => {
  const decision = evaluateCommunityOwnerAvailability({
    ownerUid: 'owner-1',
    accountStatus: 'active',
    communityStatus: 'paused',
    rawHold: {
      state: 'owner_unavailable',
      ownerUid: 'owner-1',
      accountStatus: 'self_suspended',
      previousStatus: 'dormant',
      startedAt: now - 10_000,
      policyVersion: 1,
    },
    now,
  });

  assert.deepEqual(decision, {
    kind: 'clear',
    nextStatus: 'dormant',
  });
});

test('não toca Comunidade arquivada ou em exclusão', () => {
  for (const status of ['archived', 'scheduled_for_deletion'] as const) {
    const decision = evaluateCommunityOwnerAvailability({
      ownerUid: 'owner-1',
      accountStatus: 'moderation_suspended',
      communityStatus: status,
      rawHold: null,
      now,
    });

    assert.deepEqual(decision, { kind: 'none' });
  }
});

test('hold existente preserva o status original em suspensões repetidas', () => {
  const decision = evaluateCommunityOwnerAvailability({
    ownerUid: 'owner-1',
    accountStatus: 'moderation_suspended',
    communityStatus: 'paused',
    rawHold: {
      state: 'owner_unavailable',
      ownerUid: 'owner-1',
      accountStatus: 'self_suspended',
      previousStatus: 'active',
      startedAt: now - 10_000,
      policyVersion: 1,
    },
    now,
  });

  assert.equal(decision.kind, 'apply');
  if (decision.kind !== 'apply') return;
  assert.equal(decision.hold.previousStatus, 'active');
  assert.equal(decision.hold.accountStatus, 'moderation_suspended');
});
