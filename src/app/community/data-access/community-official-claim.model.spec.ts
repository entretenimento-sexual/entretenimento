import {
  normalizeMyCommunityOfficialClaimResponse,
} from './community-official-claim.model';

describe('community-official-claim.model', () => {
  it('normaliza somente a projeção privada sanitizada', () => {
    const result = normalizeMyCommunityOfficialClaimResponse({
      claim: {
        associationKey: 'event:event-1',
        communityId: 'community-1',
        target: { type: 'event', id: 'event-1' },
        status: 'under_review',
        submittedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_010_000,
        revalidationDueAt: 1_700_100_000_000,
        verificationExpiresAt: 1_700_200_000_000,
        evidenceReferences: [
          { type: 'event_authorization_record', referenceId: 'secret-1' },
        ],
        reviewedBy: 'admin-1',
      },
      generatedAt: 1_700_000_020_000,
    });

    expect(result).toEqual({
      claim: {
        associationKey: 'event:event-1',
        communityId: 'community-1',
        target: { type: 'event', id: 'event-1' },
        status: 'under_review',
        submittedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_010_000,
        revalidationDueAt: 1_700_100_000_000,
        verificationExpiresAt: 1_700_200_000_000,
      },
      generatedAt: 1_700_000_020_000,
    });
  });

  it('aceita ausência de claim sem vazar existência de terceiro', () => {
    expect(normalizeMyCommunityOfficialClaimResponse({
      claim: null,
      generatedAt: 1_700_000_020_000,
    })).toEqual({
      claim: null,
      generatedAt: 1_700_000_020_000,
    });
  });

  it('rejeita associationKey divergente do alvo', () => {
    expect(normalizeMyCommunityOfficialClaimResponse({
      claim: {
        associationKey: 'venue:venue-2',
        communityId: 'community-1',
        target: { type: 'venue', id: 'venue-1' },
        status: 'pending',
        submittedAt: 1_700_000_000_000,
        updatedAt: 1_700_000_010_000,
        revalidationDueAt: null,
        verificationExpiresAt: null,
      },
      generatedAt: 1_700_000_020_000,
    })).toBeNull();
  });

  it('rejeita datas operacionais inválidas', () => {
    expect(normalizeMyCommunityOfficialClaimResponse({
      claim: {
        associationKey: 'profile:profile-1',
        communityId: 'community-1',
        target: { type: 'profile', id: 'profile-1' },
        status: 'pending',
        submittedAt: 1_700_000_010_000,
        updatedAt: 1_700_000_000_000,
        revalidationDueAt: null,
        verificationExpiresAt: null,
      },
      generatedAt: 1_700_000_020_000,
    })).toBeNull();
  });
});
