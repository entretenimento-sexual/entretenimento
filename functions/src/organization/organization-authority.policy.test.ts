import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateOrganizationResourceAuthority,
} from './organization-authority.policy';
import {
  sanitizeOrganizationPublicProjection,
} from './organization.model';

const NOW = 1_800_000_000_000;

function organization(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'organization-1',
    displayName: 'Organização Um',
    status: 'active',
    countryCode: 'BR',
    taxId: 'private-tax-id',
    createdAt: NOW - 10_000,
    updatedAt: NOW - 1_000,
    ...overrides,
  };
}

function kyb(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'organization-1',
    status: 'verified',
    policyVersion: 1,
    verifiedAt: NOW - 10_000,
    revalidationDueAt: NOW + 20_000,
    expiresAt: NOW + 30_000,
    revokedAt: null,
    providerEvidenceId: 'private-evidence',
    ...overrides,
  };
}

function representation(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: 'organization-1',
    holderUid: 'user-1',
    role: 'owner',
    scopes: ['manage_organization', 'community_official_claim'],
    status: 'active',
    startsAt: NOW - 10_000,
    endsAt: NOW + 30_000,
    revokedAt: null,
    ...overrides,
  };
}

function resolve(overrides: Record<string, unknown> = {}) {
  return evaluateOrganizationResourceAuthority({
    actorUid: 'user-1',
    organizationId: 'organization-1',
    rawOrganization: organization(),
    rawKyb: kyb(),
    rawRepresentation: representation(),
    requiredScope: 'community_official_claim',
    now: NOW,
    ...overrides,
  });
}

test('resolve owner com KYB e representação vigentes', () => {
  const result = resolve();
  assert.equal(result.allowed, true);
  assert.equal(result.authorityRole, 'owner');
  assert.equal(result.organizationId, 'organization-1');
  assert.equal(result.verificationPolicyVersion, 1);
});

test('mapeia representante legal sem promover role comunitária', () => {
  const result = resolve({
    rawRepresentation: representation({ role: 'legal_representative' }),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.authorityRole, 'authorized_representative');
});

test('permite manager somente com escopo explícito', () => {
  assert.equal(resolve({
    rawRepresentation: representation({ role: 'manager' }),
  }).authorityRole, 'manager');

  const denied = resolve({
    rawRepresentation: representation({
      role: 'manager',
      scopes: ['manage_organization'],
    }),
  });
  assert.equal(denied.allowed, false);
  assert.equal(denied.denialReason, 'target_authority_mismatch');
});

test('falha fechado para KYB ausente, pendente, expirado ou revogado', () => {
  assert.equal(resolve({ rawKyb: null }).denialReason, 'verification_required');
  assert.equal(resolve({ rawKyb: kyb({ status: 'pending' }) }).denialReason, 'verification_required');
  assert.equal(resolve({ rawKyb: kyb({ status: 'expired' }) }).denialReason, 'verification_inactive');
  assert.equal(resolve({ rawKyb: kyb({ status: 'revoked' }) }).denialReason, 'verification_inactive');
  assert.equal(resolve({ rawKyb: kyb({ expiresAt: NOW }) }).denialReason, 'verification_inactive');
  assert.equal(resolve({ rawKyb: kyb({ revalidationDueAt: NOW }) }).denialReason, 'verification_inactive');
});

test('rejeita representação revogada, expirada, futura ou divergente', () => {
  const cases = [
    representation({ status: 'revoked' }),
    representation({ endsAt: NOW }),
    representation({ startsAt: NOW + 1 }),
    representation({ holderUid: 'user-2' }),
    representation({ organizationId: 'organization-2' }),
  ];

  for (const rawRepresentation of cases) {
    const result = resolve({ rawRepresentation });
    assert.equal(result.allowed, false);
    assert.equal(result.denialReason, 'target_authority_mismatch');
  }
});

test('rejeita Organização inativa ou identidade canônica divergente', () => {
  assert.equal(resolve({
    rawOrganization: organization({ status: 'archived' }),
  }).denialReason, 'target_inactive');

  assert.equal(resolve({
    rawOrganization: organization({ organizationId: 'organization-2' }),
  }).denialReason, 'target_authority_mismatch');

  assert.equal(resolve({
    rawKyb: kyb({ organizationId: 'organization-2' }),
  }).denialReason, 'target_authority_mismatch');
});

test('projeção pública não expõe KYB, taxId, representantes ou evidências', () => {
  assert.deepEqual(
    sanitizeOrganizationPublicProjection(organization(), 'organization-1'),
    {
      organizationId: 'organization-1',
      displayName: 'Organização Um',
      countryCode: 'BR',
    }
  );
});
