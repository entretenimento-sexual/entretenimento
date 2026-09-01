import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityOfficialAssociationKey,
  buildVerifiedVenueOfficialAssociation,
  sanitizeCommunityOfficialAssociationPublicProjection,
} from './community-official-association.model';

test('gera chave determinística por entidade oficial', () => {
  assert.equal(buildCommunityOfficialAssociationKey({
    type: 'venue',
    id: 'venue-123',
  }), 'venue:venue-123');
});

test('cria associação privada de Local sem transformar organização em alvo público', () => {
  const association = buildVerifiedVenueOfficialAssociation({
    venueId: 'venue-123',
    communityId: 'community-123',
    sponsorOrganizationId: 'organization-1',
    holderUid: 'user-1',
    verifiedAt: 1_700_000_000_000,
    verificationPolicyVersion: 1,
  });

  assert.ok(association);
  assert.equal(association.associationKey, 'venue:venue-123');
  assert.equal(association.communityId, 'community-123');
  assert.deepEqual(association.target, { type: 'venue', id: 'venue-123' });
  assert.equal(association.status, 'verified');
  assert.equal(association.sponsorOrganizationId, 'organization-1');
  assert.deepEqual(association.authority, {
    holderUid: 'user-1',
    role: 'authorized_representative',
  });
});

test('expõe somente alvo e selo verificado na projeção pública', () => {
  const association = buildVerifiedVenueOfficialAssociation({
    venueId: 'venue-123',
    communityId: 'community-123',
    sponsorOrganizationId: 'organization-1',
    holderUid: 'user-1',
    verifiedAt: 1_700_000_000_000,
    verificationPolicyVersion: 1,
  });

  const projection = sanitizeCommunityOfficialAssociationPublicProjection(
    association
  );

  assert.deepEqual(projection, {
    target: { type: 'venue', id: 'venue-123' },
    verified: true,
  });
  assert.ok(projection);
  assert.equal('sponsorOrganizationId' in projection, false);
  assert.equal('authority' in projection, false);
  assert.equal('verification' in projection, false);
});

test('não publica associação revogada ou estruturalmente inconsistente', () => {
  assert.equal(sanitizeCommunityOfficialAssociationPublicProjection({
    associationKey: 'venue:venue-123',
    communityId: 'community-123',
    target: { type: 'venue', id: 'venue-123' },
    status: 'revoked',
  }), null);

  assert.equal(sanitizeCommunityOfficialAssociationPublicProjection({
    associationKey: 'venue:outro-id',
    communityId: 'community-123',
    target: { type: 'venue', id: 'venue-123' },
    status: 'verified',
  }), null);
});
