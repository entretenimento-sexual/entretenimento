import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityOfficialAssociationRevocation,
  resolveCommunityOfficialAssociationTerminalTransition,
} from './community-official-association-lifecycle.policy';
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

test('detecta somente entrada terminal relevante para associação oficial', () => {
  assert.deepEqual(
    resolveCommunityOfficialAssociationTerminalTransition(
      {
        status: 'active',
        officialAssociationKey: 'profile:profile-1',
      },
      {
        status: 'archived',
        officialAssociationKey: 'profile:profile-1',
      }
    ),
    {
      associationKey: 'profile:profile-1',
      reason: 'community_archived',
    }
  );

  assert.deepEqual(
    resolveCommunityOfficialAssociationTerminalTransition(
      {
        status: 'archived',
        officialAssociationKey: 'profile:profile-1',
      },
      {
        status: 'scheduled_for_deletion',
        officialAssociationKey: 'profile:profile-1',
      }
    ),
    {
      associationKey: 'profile:profile-1',
      reason: 'community_scheduled_for_deletion',
    }
  );

  assert.equal(
    resolveCommunityOfficialAssociationTerminalTransition(
      {
        status: 'archived',
        officialAssociationKey: 'profile:profile-1',
      },
      {
        status: 'archived',
        officialAssociationKey: 'profile:profile-1',
      }
    ),
    null
  );

  assert.equal(
    resolveCommunityOfficialAssociationTerminalTransition(
      { status: 'active' },
      { status: 'archived' }
    ),
    null
  );
});

test('revoga vínculo verificado sem apagar identidade ou trilha privada', () => {
  const rawAssociation = {
    associationKey: 'profile:profile-1',
    communityId: 'community-1',
    target: { type: 'profile', id: 'profile-1' },
    status: 'verified',
    sponsorOrganizationId: null,
    authority: { holderUid: 'user-1', role: 'self' },
    verification: {
      source: 'profile_verification',
      policyVersion: 1,
      verifiedAt: 1_700_000_000_000,
    },
    revokedAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
  };

  const decision = evaluateCommunityOfficialAssociationRevocation({
    rawAssociation,
    expectedAssociationKey: 'profile:profile-1',
    expectedCommunityId: 'community-1',
    revokedAt: 1_700_000_100_000,
  });

  assert.equal(decision.state, 'revoke');
  if (decision.state !== 'revoke') return;

  assert.deepEqual(decision.target, { type: 'profile', id: 'profile-1' });
  assert.deepEqual(decision.patch, {
    status: 'revoked',
    revokedAt: 1_700_000_100_000,
    updatedAt: 1_700_000_100_000,
  });
  assert.equal('authority' in decision.patch, false);
  assert.equal('verification' in decision.patch, false);
});

test('revogação é idempotente e falha fechada diante de vínculo divergente', () => {
  assert.deepEqual(
    evaluateCommunityOfficialAssociationRevocation({
      rawAssociation: {
        associationKey: 'profile:profile-1',
        communityId: 'community-1',
        status: 'revoked',
      },
      expectedAssociationKey: 'profile:profile-1',
      expectedCommunityId: 'community-1',
      revokedAt: 1_700_000_100_000,
    }),
    { state: 'already_revoked' }
  );

  assert.deepEqual(
    evaluateCommunityOfficialAssociationRevocation({
      rawAssociation: {
        associationKey: 'profile:profile-1',
        communityId: 'community-other',
        target: { type: 'profile', id: 'profile-1' },
        status: 'verified',
      },
      expectedAssociationKey: 'profile:profile-1',
      expectedCommunityId: 'community-1',
      revokedAt: 1_700_000_100_000,
    }),
    { state: 'inconsistent' }
  );

  assert.deepEqual(
    evaluateCommunityOfficialAssociationRevocation({
      rawAssociation: null,
      expectedAssociationKey: 'profile:profile-1',
      expectedCommunityId: 'community-1',
      revokedAt: 1_700_000_100_000,
    }),
    { state: 'missing' }
  );
});
