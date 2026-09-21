import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateOfficialCommunityCreationEntitlement,
  MAX_OFFICIAL_COMMUNITIES_PER_ENTITLEMENT,
  OFFICIAL_COMMUNITY_CREATION_ENTITLEMENT_POLICY_VERSION,
} from './community-official-creation-entitlement.policy';
import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';

const NOW = 1_800_000_000_000;

function entitlement(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'official_community_creation',
    policyVersion: OFFICIAL_COMMUNITY_CREATION_ENTITLEMENT_POLICY_VERSION,
    subjectType: 'organization',
    subjectId: 'organization-1',
    memberLimit: 250,
    maxOfficialCommunities: 3,
    active: true,
    startsAt: NOW - 1_000,
    endsAt: NOW + 10_000,
    ...overrides,
  };
}

test('resolve capacidade Official somente a partir do entitlement explícito', () => {
  assert.deepEqual(
    evaluateOfficialCommunityCreationEntitlement({
      expectedSubjectType: 'organization',
      expectedSubjectId: 'organization-1',
      rawEntitlement: entitlement(),
      now: NOW,
    }),
    {
      allowed: true,
      subjectType: 'organization',
      subjectId: 'organization-1',
      memberLimit: 250,
      maxOfficialCommunities: 3,
      policyVersion: OFFICIAL_COMMUNITY_CREATION_ENTITLEMENT_POLICY_VERSION,
      denialReason: null,
    }
  );
});

test('aceita ausência explícita de quota sem transformar campo ausente em ilimitado', () => {
  const unlimited = evaluateOfficialCommunityCreationEntitlement({
    expectedSubjectType: 'user',
    expectedSubjectId: 'user-1',
    rawEntitlement: entitlement({
      subjectType: 'user',
      subjectId: 'user-1',
      maxOfficialCommunities: null,
    }),
    now: NOW,
  });
  assert.equal(unlimited.allowed, true);
  assert.equal(unlimited.maxOfficialCommunities, null);

  const missing = evaluateOfficialCommunityCreationEntitlement({
    expectedSubjectType: 'user',
    expectedSubjectId: 'user-1',
    rawEntitlement: entitlement({
      subjectType: 'user',
      subjectId: 'user-1',
      maxOfficialCommunities: undefined,
    }),
    now: NOW,
  });
  assert.equal(missing.allowed, false);
  assert.equal(missing.denialReason, 'entitlement_required');
});

test('hard ceilings técnicos validam o entitlement mas não viram capacidade implícita', () => {
  assert.equal(
    MAX_OFFICIAL_COMMUNITIES_PER_ENTITLEMENT,
    COMMUNITY_PRODUCT_LIMITS.officialTechnicalSafety.maxCommunitiesPerGrant
  );

  for (const rawEntitlement of [
    null,
    entitlement({ memberLimit: undefined }),
    entitlement({
      memberLimit:
        COMMUNITY_PRODUCT_LIMITS.officialTechnicalSafety.maxMemberLimit + 1,
    }),
    entitlement({
      maxOfficialCommunities: MAX_OFFICIAL_COMMUNITIES_PER_ENTITLEMENT + 1,
    }),
  ]) {
    const result = evaluateOfficialCommunityCreationEntitlement({
      expectedSubjectType: 'organization',
      expectedSubjectId: 'organization-1',
      rawEntitlement,
      now: NOW,
    });
    assert.equal(result.allowed, false);
    assert.equal(result.memberLimit, null);
  }
});

test('rejeita entitlement de outro sujeito ou fora da janela vigente', () => {
  assert.equal(
    evaluateOfficialCommunityCreationEntitlement({
      expectedSubjectType: 'organization',
      expectedSubjectId: 'organization-2',
      rawEntitlement: entitlement(),
      now: NOW,
    }).denialReason,
    'entitlement_mismatch'
  );

  assert.equal(
    evaluateOfficialCommunityCreationEntitlement({
      expectedSubjectType: 'organization',
      expectedSubjectId: 'organization-1',
      rawEntitlement: entitlement({ endsAt: NOW }),
      now: NOW,
    }).denialReason,
    'entitlement_inactive'
  );
});
