import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_BOOST_MIN_ORGANIC_CARDS_FOR_SLOT,
  COMMUNITY_BOOST_ORGANIC_CARDS_BEFORE_SLOT,
  buildCommunityBoostSessionExclusions,
  resolveCommunityBoostInsertionAfterIndex,
} from './community-boost-display.policy';

describe('Community Boost display policy', () => {
  it('não exibe patrocinado quando a descoberta orgânica está esparsa', () => {
    expect(COMMUNITY_BOOST_MIN_ORGANIC_CARDS_FOR_SLOT).toBe(4);
    expect(resolveCommunityBoostInsertionAfterIndex(0)).toBeNull();
    expect(resolveCommunityBoostInsertionAfterIndex(1)).toBeNull();
    expect(resolveCommunityBoostInsertionAfterIndex(3)).toBeNull();
  });

  it('insere um único slot depois dos três primeiros cards orgânicos', () => {
    expect(COMMUNITY_BOOST_ORGANIC_CARDS_BEFORE_SLOT).toBe(3);
    expect(resolveCommunityBoostInsertionAfterIndex(4)).toBe(2);
    expect(resolveCommunityBoostInsertionAfterIndex(12)).toBe(2);
    expect(resolveCommunityBoostInsertionAfterIndex(48)).toBe(2);
  });

  it('prioriza a última patrocinada como exclusão da próxima alternância', () => {
    expect(buildCommunityBoostSessionExclusions({
      lastSponsoredCommunityId: 'community-sponsored-a',
      hiddenCommunityIds: [
        'community-hidden',
        'community-sponsored-a',
      ],
    })).toEqual([
      'community-sponsored-a',
      'community-hidden',
    ]);
  });

  it('não inventa exclusões quando a sessão não exibiu patrocinado', () => {
    expect(buildCommunityBoostSessionExclusions({
      lastSponsoredCommunityId: null,
      hiddenCommunityIds: [],
    })).toEqual([]);
  });
});
