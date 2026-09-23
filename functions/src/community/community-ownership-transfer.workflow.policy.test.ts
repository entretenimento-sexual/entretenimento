import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_OWNER_TERMINAL_SUCCESSION_WINDOW_MS,
  COMMUNITY_OWNERSHIP_TRANSFER_RESPONSE_WINDOW_MS,
  canAcceptCommunityOwnershipTransfer,
  canNominateCommunityOwnershipCandidate,
  isCommunityOwnershipTransferExpired,
  isCommunityOwnershipTransferPending,
  resolveCommunityOwnershipTransferExpiresAt,
} from './community-ownership-transfer.workflow.policy';

test('oferta voluntária possui janela finita de resposta', () => {
  const now = 1_900_000_000_000;
  assert.equal(
    resolveCommunityOwnershipTransferExpiresAt({ now }),
    now + COMMUNITY_OWNERSHIP_TRANSFER_RESPONSE_WINDOW_MS
  );
});

test('oferta terminal nunca ultrapassa o deadline do caso', () => {
  const now = 1_900_000_000_000;
  const terminalDeadlineAt = now + 2 * 24 * 60 * 60 * 1_000;
  assert.equal(
    resolveCommunityOwnershipTransferExpiresAt({
      now,
      terminalDeadlineAt,
    }),
    terminalDeadlineAt
  );
  assert.ok(
    COMMUNITY_OWNER_TERMINAL_SUCCESSION_WINDOW_MS
      > COMMUNITY_OWNERSHIP_TRANSFER_RESPONSE_WINDOW_MS
  );
});

test('pending/expired falham fechados por timestamp', () => {
  const now = 1_900_000_000_000;
  assert.equal(
    isCommunityOwnershipTransferPending('pending', now + 1, now),
    true
  );
  assert.equal(
    isCommunityOwnershipTransferExpired('pending', now, now),
    true
  );
  assert.equal(
    isCommunityOwnershipTransferPending('accepted', now + 1, now),
    false
  );
});

test('indicação exige elegibilidade completa do candidato', () => {
  const base = {
    explicitlyDesignated: true,
    membershipActive: true,
    accountEligible: true,
    ownershipEntitlementEligible: true,
    ownershipQuotaAvailable: true,
    ownershipCapacityCompatible: true,
  };

  assert.equal(canNominateCommunityOwnershipCandidate(base), true);

  for (const key of Object.keys(base) as Array<keyof typeof base>) {
    assert.equal(
      canNominateCommunityOwnershipCandidate({
        ...base,
        [key]: false,
      }),
      false
    );
  }
});

test('aceite revalida request, candidato, owner e capacidade', () => {
  const now = 1_900_000_000_000;
  const base = {
    requestStatus: 'pending',
    expiresAt: now + 1_000,
    now,
    candidateMatches: true,
    ownerSnapshotMatches: true,
    membershipActive: true,
    accountEligible: true,
    ownershipEntitlementEligible: true,
    ownershipQuotaAvailable: true,
    ownershipCapacityCompatible: true,
  };

  assert.equal(canAcceptCommunityOwnershipTransfer(base), true);

  for (const key of [
    'candidateMatches',
    'ownerSnapshotMatches',
    'membershipActive',
    'accountEligible',
    'ownershipEntitlementEligible',
    'ownershipQuotaAvailable',
    'ownershipCapacityCompatible',
  ] as const) {
    assert.equal(
      canAcceptCommunityOwnershipTransfer({
        ...base,
        [key]: false,
      }),
      false
    );
  }
});
