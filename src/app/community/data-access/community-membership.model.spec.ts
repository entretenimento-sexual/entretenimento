import { describe, expect, it } from 'vitest';

import { normalizeCommunityMembershipResponse } from './community-membership.model';

describe('normalizeCommunityMembershipResponse', () => {
  it('normaliza entrada ativa', () => {
    expect(
      normalizeCommunityMembershipResponse({
        status: 'active',
        viewerMode: 'member',
        canInteract: true,
      })
    ).toEqual({
      status: 'active',
      viewerMode: 'member',
      canInteract: true,
    });
  });

  it('normaliza solicitação pendente sem interação', () => {
    expect(
      normalizeCommunityMembershipResponse({
        status: 'pending',
        viewerMode: 'pending',
        canInteract: true,
      })
    ).toEqual({
      status: 'pending',
      viewerMode: 'pending',
      canInteract: false,
    });
  });

  it('descarta combinações inconsistentes', () => {
    expect(
      normalizeCommunityMembershipResponse({
        status: 'active',
        viewerMode: 'pending',
      })
    ).toBeNull();
    expect(normalizeCommunityMembershipResponse({ status: 'blocked' })).toBeNull();
  });
});
