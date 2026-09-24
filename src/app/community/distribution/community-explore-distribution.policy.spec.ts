import { describe, expect, it } from 'vitest';

import {
  EXPLORE_COMMUNITY_SECOND_SLOT_MIN_VISIBLE_COUNT,
  resolveExploreCommunityDistributionSlot,
  resolveExploreCommunityEmptySlot,
} from './community-explore-distribution.policy';

describe('community explore distribution policy', () => {
  it('usa atividade no primeiro slot quando existe atenção comunitária', () => {
    expect(
      resolveExploreCommunityDistributionSlot({
        itemIndex: 2,
        itemCount: 6,
        hasActivity: true,
        hasRecommendations: true,
      })
    ).toBe('activity');
  });

  it('usa recomendações no primeiro slot quando não há atividade', () => {
    expect(
      resolveExploreCommunityDistributionSlot({
        itemIndex: 2,
        itemCount: 6,
        hasActivity: false,
        hasRecommendations: true,
      })
    ).toBe('recommendations');
  });

  it('não perde distribuição em feeds curtos', () => {
    expect(
      resolveExploreCommunityDistributionSlot({
        itemIndex: 0,
        itemCount: 1,
        hasActivity: false,
        hasRecommendations: true,
      })
    ).toBe('recommendations');
  });

  it('só libera recomendações como segundo slot depois de nove itens', () => {
    expect(EXPLORE_COMMUNITY_SECOND_SLOT_MIN_VISIBLE_COUNT).toBe(9);

    expect(
      resolveExploreCommunityDistributionSlot({
        itemIndex: 5,
        itemCount: 6,
        hasActivity: true,
        hasRecommendations: true,
      })
    ).toBeNull();

    expect(
      resolveExploreCommunityDistributionSlot({
        itemIndex: 8,
        itemCount: 12,
        hasActivity: true,
        hasRecommendations: true,
      })
    ).toBe('recommendations');
  });

  it('prioriza atividade também quando o feed social está vazio', () => {
    expect(
      resolveExploreCommunityEmptySlot({
        hasActivity: true,
        hasRecommendations: true,
      })
    ).toBe('activity');

    expect(
      resolveExploreCommunityEmptySlot({
        hasActivity: false,
        hasRecommendations: true,
      })
    ).toBe('recommendations');
  });
});
