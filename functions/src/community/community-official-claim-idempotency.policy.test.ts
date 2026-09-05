import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCommunityOfficialClaimIdempotentStatus } from './community-official-claim-idempotency.policy';

const baseClaim = {
  associationKey: 'profile:profile-1',
  communityId: 'community-1',
  claimantUid: 'user-1',
};

test('retry idempotente usa o status corrente do claim canônico', () => {
  for (const status of [
    'pending',
    'under_review',
    'verified',
    'rejected',
    'disputed',
    'revoked',
    'expired',
  ] as const) {
    assert.equal(
      resolveCommunityOfficialClaimIdempotentStatus({
        actorUid: 'user-1',
        associationKey: 'profile:profile-1',
        communityId: 'community-1',
        claimRecord: { ...baseClaim, status },
      }),
      status
    );
  }
});

test('retry idempotente falha fechado sem claim canônico coerente', () => {
  assert.equal(
    resolveCommunityOfficialClaimIdempotentStatus({
      actorUid: 'user-1',
      associationKey: 'profile:profile-1',
      communityId: 'community-1',
      claimRecord: null,
    }),
    null
  );

  assert.equal(
    resolveCommunityOfficialClaimIdempotentStatus({
      actorUid: 'user-1',
      associationKey: 'profile:profile-1',
      communityId: 'community-1',
      claimRecord: { ...baseClaim, claimantUid: 'outro-user', status: 'verified' },
    }),
    null
  );

  assert.equal(
    resolveCommunityOfficialClaimIdempotentStatus({
      actorUid: 'user-1',
      associationKey: 'profile:profile-1',
      communityId: 'community-1',
      claimRecord: { ...baseClaim, associationKey: 'profile:profile-2', status: 'verified' },
    }),
    null
  );
});
