import { describe, expect, it } from 'vitest';

import { normalizeCommunityMembershipContextResponse } from './community-membership.model';

describe('normalizeCommunityMembershipContextResponse', () => {
  it('aceita somente IDs seguros e remove duplicados', () => {
    expect(
      normalizeCommunityMembershipContextResponse({
        activeCommunityIds: ['community-1', 'community-2', 'community-1'],
        generatedAt: 123,
      })
    ).toEqual({
      activeCommunityIds: ['community-1', 'community-2'],
      generatedAt: 123,
    });
  });

  it('rejeita payload parcial ou com ID inseguro', () => {
    expect(
      normalizeCommunityMembershipContextResponse({
        activeCommunityIds: ['../community-1'],
        generatedAt: 123,
      })
    ).toBeNull();
    expect(
      normalizeCommunityMembershipContextResponse({
        activeCommunityIds: [],
      })
    ).toBeNull();
  });

  it('rejeita resposta acima do limite backend', () => {
    expect(
      normalizeCommunityMembershipContextResponse({
        activeCommunityIds: Array.from(
          { length: 25 },
          (_, index) => `community-${index}`
        ),
        generatedAt: 123,
      })
    ).toBeNull();
  });
});
