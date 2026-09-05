import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateOrganizationOfficialClaimAuthority,
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

function organization(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizationId: 'organization-1',
    displayName: 'Organização Um',
    status: 'active',
    countryCode: 'BR',
    ...overrides,
  };
}

function kyb(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    organizationId: 'organization-1',
    status: 'verified',
    policyVersion: 3,
    verifiedAt: NOW - 10_000,
    revalidationDueAt: NOW + 20_000,
    expiresAt: NOW + 30_000,
    revokedAt: null,
    ...overrides,
  };
}

function representation(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    organizationId: 'organization-1',
    holderUid: 'user-1',
    role: 'legal_representative',
    scopes: ['community_official_claim'],
    status: 'active',
    startsAt: NOW - 10_000,
    endsAt: NOW + 30_000,
    revokedAt: null,
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

function evaluateOrganization(overrides: Partial<Parameters<
  typeof evaluateOrganizationOfficialClaimAuthority
>[0]> = {}) {
  return evaluateOrganizationOfficialClaimAuthority({
    claimantUid: 'user-1',
    organizationId: 'organization-1',
    authorityRole: 'authorized_representative',
    sponsorOrganizationId: 'organization-1',
    kybReferenceId: 'organization-1',
    authorityReferenceId: 'organization-1:user-1',
    rawOrganization: organization(),
    rawKyb: kyb(),
    rawRepresentation: representation(),
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

  it('revalida Organização com KYB e representação vigentes', () => {
    assert.deepEqual(evaluateOrganization(), {
      allowed: true,
      sponsorOrganizationId: 'organization-1',
      verificationPolicyVersion: 3,
      denialReason: null,
    });
  });

  it('rejeita KYB expirado ou revogado na aprovação', () => {
    for (const rawKyb of [
      kyb({ status: 'expired' }),
      kyb({ status: 'revoked' }),
      kyb({ expiresAt: NOW }),
      kyb({ revalidationDueAt: NOW }),
    ]) {
      const decision = evaluateOrganization({ rawKyb });
      assert.equal(decision.allowed, false);
      assert.equal(decision.denialReason, 'organization_kyb_inactive');
    }
  });

  it('rejeita representação revogada, expirada ou sem escopo na aprovação', () => {
    for (const rawRepresentation of [
      representation({ status: 'revoked' }),
      representation({ endsAt: NOW }),
      representation({ startsAt: NOW + 1 }),
      representation({ scopes: ['manage_organization'] }),
    ]) {
      const decision = evaluateOrganization({ rawRepresentation });
      assert.equal(decision.allowed, false);
      assert.equal(decision.denialReason, 'organization_authority_mismatch');
    }
  });

  it('rejeita troca de representante, papel ou referência após submissão', () => {
    assert.equal(
      evaluateOrganization({
        rawRepresentation: representation({ holderUid: 'user-2' }),
      }).denialReason,
      'organization_authority_mismatch'
    );
    assert.equal(
      evaluateOrganization({ authorityRole: 'owner' }).denialReason,
      'organization_authority_mismatch'
    );
    assert.equal(
      evaluateOrganization({
        authorityReferenceId: 'organization-1:user-2',
      }).denialReason,
      'authority_reference_mismatch'
    );
    assert.equal(
      evaluateOrganization({ sponsorOrganizationId: 'organization-2' }).denialReason,
      'sponsor_organization_mismatch'
    );
  });
});
