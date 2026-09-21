import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_BOOST_MIN_ORGANIC_CARDS_FOR_SLOT,
  COMMUNITY_BOOST_ORGANIC_CARDS_BEFORE_SLOT,
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
});
