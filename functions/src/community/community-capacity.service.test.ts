import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertCommunityOperationalForMemberGrowth,
  getCommunityCapacityForOwnerInTransaction,
} from './community-capacity.service';

function community(
  status: string,
  moderationState: string = 'active'
): Record<string, unknown> {
  return {
    status,
    moderation: { state: moderationState },
  };
}

function isCommunityUnavailableError(error: unknown): boolean {
  const source = error as {
    code?: unknown;
    details?: { reason?: unknown };
  };

  return source.code === 'failed-precondition'
    && source.details?.reason === 'community_unavailable';
}

test('permite crescimento apenas quando a comunidade está operacional', () => {
  assert.doesNotThrow(() =>
    assertCommunityOperationalForMemberGrowth(community('active'))
  );
});

test('nega crescimento em comunidade pausada, inativa ou sob moderação', () => {
  for (const rawCommunity of [
    community('paused'),
    community('dormant'),
    community('archived'),
    community('scheduled_for_deletion'),
    community('active', 'paused'),
  ]) {
    assert.throws(
      () => assertCommunityOperationalForMemberGrowth(rawCommunity),
      isCommunityUnavailableError
    );
  }
});

test('resolver transacional falha fechado antes de consultar capacidade', async () => {
  let reads = 0;
  const transaction = {
    get: async () => {
      reads += 1;
      throw new Error('não deveria consultar Firestore');
    },
  } as unknown as FirebaseFirestore.Transaction;

  await assert.rejects(
    () => getCommunityCapacityForOwnerInTransaction(
      transaction,
      community('paused')
    ),
    isCommunityUnavailableError
  );
  assert.equal(reads, 0);
});
