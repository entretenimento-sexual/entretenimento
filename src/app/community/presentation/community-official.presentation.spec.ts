import { describe, expect, it } from 'vitest';

import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import { resolveCommunityOfficialPresentation } from './community-official.presentation';

function buildCard(
  source: CommunityPreviewCard['source'],
  target: NonNullable<CommunityPreviewCard['officialAssociation']>['target']
): CommunityPreviewCard {
  return {
    communityId: 'community-1234567890123456',
    name: 'Espaço teste',
    slug: 'espaco-teste',
    description: null,
    source,
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 10, postCount: 2, mediaCount: 1 },
    access: {
      join: 'open',
      minimumRole: null,
      requiresActiveSubscription: false,
    },
    tags: [],
    officialAssociation: {
      target,
      verified: true,
    },
  };
}

describe('resolveCommunityOfficialPresentation', () => {
  it('apresenta Local oficial quando associação e source apontam para o mesmo venue', () => {
    expect(resolveCommunityOfficialPresentation(buildCard(
      { type: 'venue', id: 'venue-1234567890123456' },
      { type: 'venue', id: 'venue-1234567890123456' }
    ))).toEqual({
      label: 'Local oficial',
      ariaLabel: 'Local com vínculo oficial verificado',
    });
  });

  it('distingue vínculos oficiais de perfil, organização e evento', () => {
    expect(resolveCommunityOfficialPresentation(buildCard(
      { type: 'community', id: 'community-1234567890123456' },
      { type: 'profile', id: 'profile-11111111-1111-4111-8111-111111111111' }
    ))?.label).toBe('Oficial do perfil');

    expect(resolveCommunityOfficialPresentation(buildCard(
      { type: 'community', id: 'community-1234567890123456' },
      { type: 'organization', id: 'organization-1234567890123456' }
    ))?.label).toBe('Oficial da organização');

    expect(resolveCommunityOfficialPresentation(buildCard(
      { type: 'community', id: 'community-1234567890123456' },
      { type: 'event', id: 'event-1234567890123456' }
    ))?.label).toBe('Oficial do evento');
  });

  it('não exibe selo quando a associação oficial não está presente', () => {
    const card = buildCard(
      { type: 'community', id: 'community-1234567890123456' },
      { type: 'organization', id: 'organization-1234567890123456' }
    );

    expect(resolveCommunityOfficialPresentation({
      ...card,
      officialAssociation: null,
    })).toBeNull();
  });
});
