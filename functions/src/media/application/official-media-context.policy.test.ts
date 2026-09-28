import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deriveOfficialMediaContext,
  officialMediaContextMatches,
} from './official-media-context.policy';

const NOW = 1_800_000_000_000;

function verifiedKyc() {
  return {
    uid: 'owner-1',
    profileId: 'profile-1',
    status: 'verified',
    verifiedAt: NOW - 10_000,
    policyVersion: 1,
    expiresAt: NOW + 60_000,
    revalidationDueAt: NOW + 30_000,
    revokedAt: null,
  };
}

function verifiedAssociation() {
  return {
    associationKey: 'profile:profile-1',
    communityId: 'community-1',
    target: { type: 'profile', id: 'profile-1' },
    status: 'verified',
    verification: {
      expiresAt: NOW + 60_000,
    },
  };
}

describe('official-media-context.policy', () => {
  it('deriva contexto somente de identidade + associação + target válidos', () => {
    const context = deriveOfficialMediaContext({
      ownerUid: 'owner-1',
      rawUser: { profileId: 'profile-1' },
      rawProfileKyc: verifiedKyc(),
      rawAssociation: verifiedAssociation(),
      nowMs: NOW,
    });

    assert.deepEqual(context, {
      identity: { verified: true, type: 'profile' },
      association: { verified: true },
      target: { type: 'profile', id: 'profile-1' },
    });
  });

  it('falha fechado quando qualquer autoridade deixa de valer', () => {
    const cases = [
      {
        rawUser: { profileId: 'profile-2' },
        rawProfileKyc: verifiedKyc(),
        rawAssociation: verifiedAssociation(),
      },
      {
        rawUser: { profileId: 'profile-1' },
        rawProfileKyc: { ...verifiedKyc(), status: 'revoked' },
        rawAssociation: verifiedAssociation(),
      },
      {
        rawUser: { profileId: 'profile-1' },
        rawProfileKyc: verifiedKyc(),
        rawAssociation: {
          ...verifiedAssociation(),
          status: 'revoked',
        },
      },
      {
        rawUser: { profileId: 'profile-1' },
        rawProfileKyc: verifiedKyc(),
        rawAssociation: {
          ...verifiedAssociation(),
          target: { type: 'profile', id: 'profile-2' },
          associationKey: 'profile:profile-2',
        },
      },
    ];

    for (const candidate of cases) {
      assert.equal(
        deriveOfficialMediaContext({
          ownerUid: 'owner-1',
          ...candidate,
          nowMs: NOW,
        }),
        null
      );
    }
  });

  it('não trata projeção divergente como contexto válido', () => {
    const expected = deriveOfficialMediaContext({
      ownerUid: 'owner-1',
      rawUser: { profileId: 'profile-1' },
      rawProfileKyc: verifiedKyc(),
      rawAssociation: verifiedAssociation(),
      nowMs: NOW,
    });

    assert.ok(expected);
    assert.equal(officialMediaContextMatches({
      identity: { verified: true, type: 'profile' },
      association: { verified: true },
      target: { type: 'profile', id: 'profile-2' },
    }, expected), false);
  });
});
