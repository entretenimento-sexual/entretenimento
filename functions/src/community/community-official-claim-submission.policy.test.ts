import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCommunityOfficialClaimSubmission } from './community-official-claim-submission.policy';

const NOW = 1_800_000_000_000;
const intent = {
  requestId: 'request-1',
  communityId: 'community-1',
  target: { type: 'venue' as const, id: 'venue-1' },
  associationKey: 'venue:venue-1',
};

function activeGrant() {
  return {
    holderUid: 'user-1',
    scope: 'official_space_creation',
    verificationStatus: 'verified',
    policyVersion: 1,
    organizationId: 'organization-1',
    maxOfficialSpaces: 10,
    active: true,
    startsAt: NOW - 1_000,
    endsAt: NOW + 10_000,
  };
}

test('deriva organização, papel e evidência sem confiar no cliente', () => {
  const result = resolveCommunityOfficialClaimSubmission({
    actorUid: 'user-1',
    intent,
    rawGrant: activeGrant(),
    rawTarget: {
      status: 'active',
      ownerUid: 'user-1',
      adminUids: [],
    },
    now: NOW,
  });

  assert.deepEqual(result, {
    command: {
      ...intent,
      authorityRole: 'owner',
      sponsorOrganizationId: 'organization-1',
      evidenceReferences: [
        { type: 'authority_record', referenceId: 'user-1' },
      ],
    },
    denialReason: null,
  });
});

test('deriva manager para administrador ativo do Local', () => {
  const result = resolveCommunityOfficialClaimSubmission({
    actorUid: 'user-1',
    intent,
    rawGrant: activeGrant(),
    rawTarget: {
      status: 'active',
      ownerUid: 'outro-user',
      adminUids: ['user-1'],
    },
    now: NOW,
  });

  assert.equal(result.command?.authorityRole, 'manager');
});

test('falha fechado para alvo sem fonte canônica ou sem autoridade', () => {
  assert.equal(
    resolveCommunityOfficialClaimSubmission({
      actorUid: 'user-1',
      intent: {
        ...intent,
        target: { type: 'profile', id: 'profile-1' },
        associationKey: 'profile:profile-1',
      },
      rawGrant: activeGrant(),
      rawTarget: null,
      now: NOW,
    }).denialReason,
    'unsupported_target'
  );

  assert.equal(
    resolveCommunityOfficialClaimSubmission({
      actorUid: 'user-1',
      intent,
      rawGrant: activeGrant(),
      rawTarget: {
        status: 'active',
        ownerUid: 'outro-user',
        adminUids: [],
      },
      now: NOW,
    }).denialReason,
    'target_authority_mismatch'
  );
});
