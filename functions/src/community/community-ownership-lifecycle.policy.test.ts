// functions/src/community/community-ownership-lifecycle.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityArchive,
  evaluateCommunityOwnershipIdempotencyReplay,
  evaluateCommunityOwnershipTransfer,
} from './community-ownership-lifecycle.policy';

const TRANSFER_BASE = Object.freeze({
  sourceType: 'community' as const,
  communityStatus: 'active' as const,
  actorUid: 'owner-1',
  targetUid: 'member-1',
  actorStatus: 'active' as const,
  actorRole: 'owner' as const,
  targetStatus: 'active' as const,
  targetRole: 'member' as const,
  targetAccountEligible: true,
  targetOwnershipEntitlementEligible: true,
  activeOwnerCount: 1,
});

const ARCHIVE_BASE = Object.freeze({
  sourceType: 'community' as const,
  communityStatus: 'active' as const,
  actorStatus: 'active' as const,
  actorRole: 'owner' as const,
  activeOwnerCount: 1,
  lifecycleHold: false,
});

test('permite transferir para membro ativo e elegível', () => {
  const decision = evaluateCommunityOwnershipTransfer(TRANSFER_BASE);

  assert.equal(decision.allowed, true);
  assert.equal(decision.actorNextRole, 'member');
  assert.equal(decision.targetNextRole, 'owner');
  assert.equal(decision.denialReason, null);
});

test('permite transferir para administração ou moderação ativa', () => {
  const admin = evaluateCommunityOwnershipTransfer({
    ...TRANSFER_BASE,
    targetRole: 'admin',
  });
  const moderator = evaluateCommunityOwnershipTransfer({
    ...TRANSFER_BASE,
    targetRole: 'moderator',
  });

  assert.equal(admin.allowed, true);
  assert.equal(moderator.allowed, true);
});

test('nega transferência para o próprio owner', () => {
  const decision = evaluateCommunityOwnershipTransfer({
    ...TRANSFER_BASE,
    targetUid: TRANSFER_BASE.actorUid,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'self_transfer_forbidden');
});

test('nega transferência sem owner canônico único', () => {
  assert.equal(
    evaluateCommunityOwnershipTransfer({
      ...TRANSFER_BASE,
      activeOwnerCount: 0,
    }).denialReason,
    'ownership_inconsistent'
  );
  assert.equal(
    evaluateCommunityOwnershipTransfer({
      ...TRANSFER_BASE,
      activeOwnerCount: 2,
    }).denialReason,
    'ownership_inconsistent'
  );
});

test('nega alvo pendente, bloqueado, inativo ou inelegível', () => {
  assert.equal(
    evaluateCommunityOwnershipTransfer({
      ...TRANSFER_BASE,
      targetStatus: 'pending',
    }).denialReason,
    'target_membership_ineligible'
  );
  assert.equal(
    evaluateCommunityOwnershipTransfer({
      ...TRANSFER_BASE,
      targetRole: 'owner',
    }).denialReason,
    'target_membership_ineligible'
  );
  assert.equal(
    evaluateCommunityOwnershipTransfer({
      ...TRANSFER_BASE,
      targetAccountEligible: false,
    }).denialReason,
    'target_account_ineligible'
  );
  assert.equal(
    evaluateCommunityOwnershipTransfer({
      ...TRANSFER_BASE,
      targetOwnershipEntitlementEligible: false,
    }).denialReason,
    'target_ownership_entitlement_ineligible'
  );
});

test('nega transferência de Local e de comunidade encerrada', () => {
  assert.equal(
    evaluateCommunityOwnershipTransfer({
      ...TRANSFER_BASE,
      sourceType: 'venue',
    }).denialReason,
    'community_source_not_supported'
  );
  assert.equal(
    evaluateCommunityOwnershipTransfer({
      ...TRANSFER_BASE,
      communityStatus: 'archived',
    }).denialReason,
    'community_unavailable'
  );
});

test('permite arquivar comunidade ativa ou pausada', () => {
  const active = evaluateCommunityArchive(ARCHIVE_BASE);
  const paused = evaluateCommunityArchive({
    ...ARCHIVE_BASE,
    communityStatus: 'paused',
  });

  assert.equal(active.allowed, true);
  assert.equal(active.idempotent, false);
  assert.equal(active.actorNextRole, 'member');
  assert.equal(active.actorNextStatus, 'left');
  assert.equal(paused.allowed, true);
});

test('arquivamento já concluído é idempotente', () => {
  const decision = evaluateCommunityArchive({
    ...ARCHIVE_BASE,
    communityStatus: 'archived',
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.idempotent, true);
  assert.equal(decision.actorNextRole, null);
  assert.equal(decision.actorNextStatus, null);
});

test('nega arquivamento sem owner único ou com hold', () => {
  assert.equal(
    evaluateCommunityArchive({
      ...ARCHIVE_BASE,
      activeOwnerCount: 2,
    }).denialReason,
    'ownership_inconsistent'
  );
  assert.equal(
    evaluateCommunityArchive({
      ...ARCHIVE_BASE,
      lifecycleHold: true,
    }).denialReason,
    'community_lifecycle_hold'
  );
});

test('nega arquivamento de Local ou por não owner', () => {
  assert.equal(
    evaluateCommunityArchive({
      ...ARCHIVE_BASE,
      sourceType: 'venue',
    }).denialReason,
    'community_source_not_supported'
  );
  assert.equal(
    evaluateCommunityArchive({
      ...ARCHIVE_BASE,
      actorRole: 'admin',
    }).denialReason,
    'owner_required'
  );
});


const REPLAY_BASE = Object.freeze({
  rawRequest: {
    operation: 'transfer',
    requestId: 'request-1',
    actorUid: 'owner-1',
    targetUid: 'member-1',
    communityId: 'community-1',
    status: 'completed',
    completedAt: 123_456,
  },
  expectedOperation: 'transfer' as const,
  expectedRequestId: 'request-1',
  expectedActorUid: 'owner-1',
  expectedCommunityId: 'community-1',
  expectedTargetUid: 'member-1',
});

test('aceita replay idempotente íntegro de transferência', () => {
  assert.deepEqual(
    evaluateCommunityOwnershipIdempotencyReplay(REPLAY_BASE),
    { state: 'valid', completedAt: 123_456 }
  );
});

test('classifica identidade divergente de replay como conflito', () => {
  for (const input of [
    { ...REPLAY_BASE, expectedRequestId: 'request-2' },
    { ...REPLAY_BASE, expectedActorUid: 'owner-2' },
    { ...REPLAY_BASE, expectedCommunityId: 'community-2' },
    { ...REPLAY_BASE, expectedTargetUid: 'member-2' },
  ]) {
    assert.deepEqual(
      evaluateCommunityOwnershipIdempotencyReplay(input),
      { state: 'conflict' }
    );
  }
});

test('replay com status ou timestamp corrompido falha fechado', () => {
  for (const rawRequest of [
    { ...REPLAY_BASE.rawRequest, status: 'pending' },
    { ...REPLAY_BASE.rawRequest, completedAt: undefined },
    { ...REPLAY_BASE.rawRequest, completedAt: '123456' },
    { ...REPLAY_BASE.rawRequest, completedAt: 123.5 },
    { ...REPLAY_BASE.rawRequest, completedAt: 0 },
  ]) {
    assert.deepEqual(
      evaluateCommunityOwnershipIdempotencyReplay({
        ...REPLAY_BASE,
        rawRequest,
      }),
      { state: 'invalid' }
    );
  }
});

test('aceita replay idempotente íntegro de arquivamento', () => {
  assert.deepEqual(
    evaluateCommunityOwnershipIdempotencyReplay({
      rawRequest: {
        operation: 'archive',
        requestId: 'request-archive',
        actorUid: 'owner-1',
        communityId: 'community-1',
        status: 'completed',
        completedAt: 654_321,
      },
      expectedOperation: 'archive',
      expectedRequestId: 'request-archive',
      expectedActorUid: 'owner-1',
      expectedCommunityId: 'community-1',
    }),
    { state: 'valid', completedAt: 654_321 }
  );
});
