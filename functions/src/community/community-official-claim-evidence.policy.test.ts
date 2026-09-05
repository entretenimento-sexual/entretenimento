import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateVenueOfficialClaimAuthorityGrant,
} from './community-official-claim-evidence.policy';
import { OFFICIAL_SPACE_CREATION_POLICY_VERSION } from './community-official-space.policy';

const NOW = 1_800_000_000_000;

function grant(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    holderUid: 'user-1',
    organizationId: 'org-1',
    scope: 'official_space_creation',
    verificationStatus: 'verified',
    policyVersion: OFFICIAL_SPACE_CREATION_POLICY_VERSION,
    active: true,
    startsAt: NOW - 10_000,
    endsAt: NOW + 10_000,
    maxOfficialSpaces: 5,
    ...overrides,
  };
}

function venue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ownerUid: 'user-1',
    adminUids: [],
    status: 'active',
    ...overrides,
  };
}

function evaluate(overrides: Partial<Parameters<
  typeof evaluateVenueOfficialClaimAuthorityGrant
>[0]> = {}) {
  return evaluateVenueOfficialClaimAuthorityGrant({
    claimantUid: 'user-1',
    venueId: 'venue-1',
    authorityRole: 'owner',
    sponsorOrganizationId: 'org-1',
    authorityReferenceId: 'user-1',
    rawGrant: grant(),
    rawVenue: venue(),
    now: NOW,
    ...overrides,
  });
}

describe('community official claim evidence policy', () => {
  it('aceita grant vigente e autoridade atual sobre o Local', () => {
    assert.deepEqual(evaluate(), {
      allowed: true,
      sponsorOrganizationId: 'org-1',
      verificationPolicyVersion: OFFICIAL_SPACE_CREATION_POLICY_VERSION,
      denialReason: null,
    });
  });

  it('resolve a organização canônica do grant quando o claim não a informa', () => {
    const decision = evaluate({
      authorityRole: 'authorized_representative',
      sponsorOrganizationId: null,
      rawVenue: venue({ ownerUid: 'owner-2', adminUids: ['user-1'] }),
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.sponsorOrganizationId, 'org-1');
  });

  it('rejeita referência que não seja o grant canônico do solicitante', () => {
    const decision = evaluate({ authorityReferenceId: 'user-2' });

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'authority_reference_mismatch');
  });

  it('rejeita identificador de Local inválido antes da revalidação', () => {
    const decision = evaluate({ venueId: 'venue inválido' });

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'authority_reference_mismatch');
  });

  it('rejeita grant inativo ou expirado', () => {
    const decision = evaluate({ rawGrant: grant({ endsAt: NOW - 1 }) });

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'authority_grant_inactive');
  });

  it('rejeita grant pertencente a outro responsável', () => {
    const decision = evaluate({ rawGrant: grant({ holderUid: 'user-2' }) });

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'authority_grant_invalid');
  });

  it('rejeita organização patrocinadora divergente do registro verificado', () => {
    const decision = evaluate({
      authorityRole: 'manager',
      sponsorOrganizationId: 'org-2',
      rawVenue: venue({ ownerUid: 'owner-2', adminUids: ['user-1'] }),
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'sponsor_organization_mismatch');
  });

  it('rejeita solicitante sem autoridade atual sobre o Local alvo', () => {
    const decision = evaluate({
      authorityRole: 'authorized_representative',
      rawVenue: venue({ ownerUid: 'owner-2', adminUids: ['user-3'] }),
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'venue_authority_mismatch');
  });

  it('rejeita papel de owner quando a fonte canônica comprova apenas manager', () => {
    const decision = evaluate({
      authorityRole: 'owner',
      rawVenue: venue({ ownerUid: 'owner-2', adminUids: ['user-1'] }),
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'venue_authority_mismatch');
  });

  it('rejeita Local que deixou de estar ativo', () => {
    const decision = evaluate({ rawVenue: venue({ status: 'archived' }) });

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'venue_not_active');
  });
});
