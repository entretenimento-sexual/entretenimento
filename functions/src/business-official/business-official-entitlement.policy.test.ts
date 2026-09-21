import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUSINESS_OFFICIAL_ENTITLEMENT_POLICY_VERSION,
  BUSINESS_OFFICIAL_ENTITLEMENT_SCOPE,
  buildBusinessOfficialEntitlementDocument,
  buildBusinessOfficialEntitlementId,
  evaluateBusinessOfficialEntitlement,
} from './business-official-entitlement.policy';

const NOW = 1_800_000_000_000;

function entitlement(overrides: Record<string, unknown> = {}) {
  return {
    scope: BUSINESS_OFFICIAL_ENTITLEMENT_SCOPE,
    policyVersion: BUSINESS_OFFICIAL_ENTITLEMENT_POLICY_VERSION,
    subjectType: 'organization',
    subjectId: 'organization-1',
    capabilities: {
      officialCommunityCreation: {
        memberLimit: 250,
        maxOwned: 4,
      },
      officialVenueCreation: {
        memberLimit: 100,
        maxOwned: 2,
      },
    },
    active: true,
    startsAt: NOW - 1_000,
    endsAt: NOW + 10_000,
    ...overrides,
  };
}

test('Business/Official é a fonte canônica de capacidades efetivas', () => {
  const result = evaluateBusinessOfficialEntitlement({
    expectedSubjectType: 'organization',
    expectedSubjectId: 'organization-1',
    rawEntitlement: entitlement(),
    now: NOW,
  });

  assert.equal(result.allowed, true);
  assert.deepEqual(result.capabilities, {
    officialCommunityCreation: {
      memberLimit: 250,
      maxOwned: 4,
    },
    officialVenueCreation: {
      memberLimit: 100,
      maxOwned: 2,
    },
  });
});

test('entitlement não aceita preço ou plano como parte do contrato autorizativo', () => {
  for (const extra of [
    { planKey: 'business' },
    { planId: 'business-monthly' },
    { amountCents: 9999 },
    { priceCents: 9999 },
    { currency: 'BRL' },
  ]) {
    const result = evaluateBusinessOfficialEntitlement({
      expectedSubjectType: 'organization',
      expectedSubjectId: 'organization-1',
      rawEntitlement: entitlement(extra),
      now: NOW,
    });

    assert.equal(result.allowed, false);
    assert.equal(result.denialReason, 'entitlement_required');
  }
});

test('capabilities são explícitas: null desabilita uma superfície e ausência falha fechada', () => {
  const onlyCommunity = evaluateBusinessOfficialEntitlement({
    expectedSubjectType: 'organization',
    expectedSubjectId: 'organization-1',
    rawEntitlement: entitlement({
      capabilities: {
        officialCommunityCreation: {
          memberLimit: 500,
          maxOwned: null,
        },
        officialVenueCreation: null,
      },
    }),
    now: NOW,
  });

  assert.equal(onlyCommunity.allowed, true);
  assert.equal(onlyCommunity.capabilities?.officialVenueCreation, null);

  const missingKey = evaluateBusinessOfficialEntitlement({
    expectedSubjectType: 'organization',
    expectedSubjectId: 'organization-1',
    rawEntitlement: entitlement({
      capabilities: {
        officialCommunityCreation: {
          memberLimit: 500,
          maxOwned: null,
        },
      },
    }),
    now: NOW,
  });
  assert.equal(missingKey.allowed, false);
});

test('ID canônico é independente de associação oficial', () => {
  assert.equal(
    buildBusinessOfficialEntitlementId({
      subjectType: 'organization',
      subjectId: 'organization-1',
    }),
    'business_official:organization:organization-1'
  );
});

test('builder persiste somente direitos efetivos e metadados operacionais', () => {
  const document = buildBusinessOfficialEntitlementDocument({
    subjectType: 'organization',
    subjectId: 'organization-1',
    capabilities: {
      officialCommunityCreation: {
        memberLimit: 250,
        maxOwned: 3,
      },
      officialVenueCreation: null,
    },
    startsAt: NOW,
    endsAt: NOW + 10_000,
    createdAt: NOW,
    updatedAt: NOW,
    updatedBy: 'admin-1',
  });

  assert.ok(document);
  assert.equal(document['scope'], 'business_official');
  assert.equal('planKey' in document, false);
  assert.equal('amountCents' in document, false);
  assert.equal('priceCents' in document, false);
  assert.equal('communityOfficialAssociationKey' in document, false);
});
