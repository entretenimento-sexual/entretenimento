import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityMembershipVisibility,
} from './community-membership-visibility.policy';
import {
  isCurrentPublicProfileForCommunityDisclosure,
} from './get-profile-public-communities.handler';

const community = {
  visibility: 'public_preview',
  status: 'active',
  moderation: { state: 'active' },
  membershipDisclosure: {
    profileMembership: 'opt_in',
    policyVersion: 3,
  },
};

test('perfil público exige consentimento explícito da versão atual', () => {
  assert.equal(
    resolveCommunityMembershipVisibility(community, {
      status: 'active',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 3,
    }).visible,
    true
  );

  for (const membership of [
    { status: 'active' },
    { status: 'active', profileVisibility: 'hidden' },
    {
      status: 'active',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 2,
    },
    {
      status: 'left',
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 3,
    },
  ]) {
    assert.equal(
      resolveCommunityMembershipVisibility(community, membership).visible,
      false
    );
  }
});


test('perfil público resolve UID pela identidade pública antes do bloqueio bilateral', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').resolve(
      process.cwd(),
      'src/community/get-profile-public-communities.handler.ts'
    ),
    'utf8'
  );

  const publicProfileRead = source.indexOf("collection('public_profiles')");
  const profileIdFilter = source.indexOf(".where('profileId', '==', profileId)");
  const blockCheck = source.indexOf('assertNoActiveBilateralBlock(');

  assert.ok(publicProfileRead >= 0);
  assert.ok(profileIdFilter > publicProfileRead);
  assert.ok(blockCheck > profileIdFilter);
  assert.match(source, /\.limit\(2\)/);
});

test('perfil público não aceita UID interno como identidade enviada pelo cliente', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').resolve(
      process.cwd(),
      'src/community/get-profile-public-communities.handler.ts'
    ),
    'utf8'
  );

  assert.match(source, /profileId\?: unknown/);
  assert.doesNotMatch(source, /profileUid\?: unknown/);
  assert.match(source, /normalizePublicProfileId\(request\.data\?\.profileId\)/);
});

test('profileId duplicado ou UID resolvido inválido falham fechado', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').resolve(
      process.cwd(),
      'src/community/get-profile-public-communities.handler.ts'
    ),
    'utf8'
  );

  assert.match(source, /if \(publicProfilesSnapshot\.size > 1\)/);
  assert.match(source, /public_profile_identity_duplicate/);
  assert.match(source, /public_profile_identity_invalid/);
  assert.match(source, /'data-loss'/);
});


test('comunidades públicas do perfil exigem projeção etária vigente', () => {
  const now = 1_800_000_000_000;

  assert.equal(
    isCurrentPublicProfileForCommunityDisclosure(
      {
        ageEligibilityVerifiedAdult: true,
        ageEligibilityValidUntil: { toMillis: () => now + 60_000 },
      },
      now
    ),
    true
  );

  assert.equal(
    isCurrentPublicProfileForCommunityDisclosure(
      {
        ageEligibilityVerifiedAdult: true,
        ageEligibilityValidUntil: { toMillis: () => now },
      },
      now
    ),
    false
  );

  assert.equal(
    isCurrentPublicProfileForCommunityDisclosure(
      {
        ageEligibilityVerifiedAdult: false,
        ageEligibilityValidUntil: { toMillis: () => now + 60_000 },
      },
      now
    ),
    false
  );
});
