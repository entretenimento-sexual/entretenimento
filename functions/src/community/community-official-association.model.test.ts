import {
  buildCommunityOfficialAssociationKey,
  buildVerifiedVenueOfficialAssociation,
  sanitizeCommunityOfficialAssociationPublicProjection,
} from './community-official-association.model';

describe('community-official-association.model', () => {
  it('gera chave determinística por entidade oficial', () => {
    expect(buildCommunityOfficialAssociationKey({
      type: 'venue',
      id: 'venue-123',
    })).toBe('venue:venue-123');
  });

  it('cria associação privada de Local sem transformar organização em alvo público', () => {
    const association = buildVerifiedVenueOfficialAssociation({
      venueId: 'venue-123',
      communityId: 'community-123',
      sponsorOrganizationId: 'organization-1',
      holderUid: 'user-1',
      verifiedAt: 1_700_000_000_000,
      verificationPolicyVersion: 1,
    });

    expect(association).toEqual(expect.objectContaining({
      associationKey: 'venue:venue-123',
      communityId: 'community-123',
      target: { type: 'venue', id: 'venue-123' },
      status: 'verified',
      sponsorOrganizationId: 'organization-1',
    }));
    expect(association?.authority).toEqual({
      holderUid: 'user-1',
      role: 'authorized_representative',
    });
  });

  it('expõe somente alvo e selo verificado na projeção pública', () => {
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

    expect(projection).toEqual({
      target: { type: 'venue', id: 'venue-123' },
      verified: true,
    });
    expect(projection).not.toHaveProperty('sponsorOrganizationId');
    expect(projection).not.toHaveProperty('authority');
    expect(projection).not.toHaveProperty('verification');
  });

  it('não publica associação revogada ou estruturalmente inconsistente', () => {
    expect(sanitizeCommunityOfficialAssociationPublicProjection({
      associationKey: 'venue:venue-123',
      communityId: 'community-123',
      target: { type: 'venue', id: 'venue-123' },
      status: 'revoked',
    })).toBeNull();

    expect(sanitizeCommunityOfficialAssociationPublicProjection({
      associationKey: 'venue:outro-id',
      communityId: 'community-123',
      target: { type: 'venue', id: 'venue-123' },
      status: 'verified',
    })).toBeNull();
  });
});
