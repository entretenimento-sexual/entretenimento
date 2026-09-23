import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_BOOST_AUTHORITY_SNAPSHOT_VERSION,
  evaluateCommunityBoostAuthority,
  type CommunityBoostAuthorityCurrentState,
  type CommunityBoostAuthoritySnapshot,
} from './community-boost-authority.policy';

const SNAPSHOT: CommunityBoostAuthoritySnapshot = Object.freeze({
  version: COMMUNITY_BOOST_AUTHORITY_SNAPSHOT_VERSION,
  advertiserUid: 'owner-1',
  communityOwnerUid: 'owner-1',
  communityOwnerTransferredAt: null,
  role: 'owner',
});

const CURRENT: CommunityBoostAuthorityCurrentState = Object.freeze({
  advertiserUid: 'owner-1',
  advertiserEligible: true,
  advertiserPlatformAdmin: false,
  communityStatus: 'active',
  communityModerationState: 'active',
  communityOwnerUid: 'owner-1',
  communityOwnerTransferredAt: null,
  membershipStatus: 'active',
  membershipRole: 'owner',
});

test('mantém cobrança apenas enquanto ownership e autoridade continuam idênticos', () => {
  assert.deepEqual(
    evaluateCommunityBoostAuthority({
      snapshot: SNAPSHOT,
      current: CURRENT,
    }),
    { allowed: true, denialReason: null }
  );
});

test('transferência invalida definitivamente a campanha antiga', () => {
  const transferred = evaluateCommunityBoostAuthority({
    snapshot: SNAPSHOT,
    current: {
      ...CURRENT,
      communityOwnerUid: 'owner-2',
      communityOwnerTransferredAt: 1_900_000_000_000,
      membershipRole: 'admin',
    },
  });

  assert.equal(transferred.allowed, false);
  assert.equal(transferred.denialReason, 'community_ownership_changed');
});

test('transferir e depois devolver ownership não reativa snapshot antigo', () => {
  const returned = evaluateCommunityBoostAuthority({
    snapshot: SNAPSHOT,
    current: {
      ...CURRENT,
      communityOwnerTransferredAt: 1_900_000_100_000,
    },
  });

  assert.equal(returned.allowed, false);
  assert.equal(returned.denialReason, 'community_ownership_changed');
});

test('arquivamento ou moderação interrompem nova cobrança', () => {
  for (const current of [
    { ...CURRENT, communityStatus: 'archived' },
    { ...CURRENT, communityModerationState: 'hidden' },
  ]) {
    const decision = evaluateCommunityBoostAuthority({
      snapshot: SNAPSHOT,
      current,
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'community_unavailable');
  }
});

test('suspensão/cancelamento de elegibilidade do anunciante interrompe cobrança', () => {
  const decision = evaluateCommunityBoostAuthority({
    snapshot: SNAPSHOT,
    current: {
      ...CURRENT,
      advertiserEligible: false,
    },
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'advertiser_account_ineligible');
});

test('perda de role gerencial interrompe campanha de owner/admin', () => {
  for (const membershipRole of ['moderator', 'member', null]) {
    const decision = evaluateCommunityBoostAuthority({
      snapshot: SNAPSHOT,
      current: {
        ...CURRENT,
        membershipRole,
      },
    });
    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'advertiser_authority_lost');
  }

  const adminDecision = evaluateCommunityBoostAuthority({
    snapshot: { ...SNAPSHOT, role: 'admin' },
    current: {
      ...CURRENT,
      communityOwnerUid: 'owner-2',
      advertiserUid: 'owner-1',
      membershipRole: 'admin',
    },
  });
  assert.equal(adminDecision.allowed, false);
  assert.equal(
    adminDecision.denialReason,
    'community_ownership_changed'
  );
});

test('campanha legada sem snapshot explícito falha fechada', () => {
  const decision = evaluateCommunityBoostAuthority({
    snapshot: null,
    current: CURRENT,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'authority_anchor_missing');
});
