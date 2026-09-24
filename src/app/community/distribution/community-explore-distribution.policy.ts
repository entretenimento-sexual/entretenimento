// src/app/community/distribution/community-explore-distribution.policy.ts
export type ExploreCommunityDistributionSlot =
  | 'activity'
  | 'recommendations'
  | null;

export interface ExploreCommunityDistributionAvailability {
  readonly hasActivity: boolean;
  readonly hasRecommendations: boolean;
}

export interface ExploreCommunityDistributionPosition
  extends ExploreCommunityDistributionAvailability {
  readonly itemIndex: number;
  readonly itemCount: number;
}

/**
 * A primeira inserção ocorre após no máximo três itens sociais.
 * Quando atividade ocupa esse primeiro slot, recomendações só podem aparecer
 * no segundo lote, após nove itens sociais visíveis. Assim o Explore ganha
 * distribuição comunitária sem virar um feed de Comunidades.
 */
export const EXPLORE_COMMUNITY_SECOND_SLOT_MIN_VISIBLE_COUNT = 9;

export function resolveExploreCommunityDistributionSlot(
  input: ExploreCommunityDistributionPosition
): ExploreCommunityDistributionSlot {
  const itemCount = normalizeCount(input.itemCount);
  const itemIndex = Math.trunc(Number(input.itemIndex));

  if (itemCount === 0 || itemIndex < 0 || itemIndex >= itemCount) {
    return null;
  }

  const firstSlotAfterIndex = Math.min(2, itemCount - 1);

  if (itemIndex === firstSlotAfterIndex) {
    if (input.hasActivity) return 'activity';
    return input.hasRecommendations ? 'recommendations' : null;
  }

  if (
    itemCount >= EXPLORE_COMMUNITY_SECOND_SLOT_MIN_VISIBLE_COUNT
    && itemIndex === EXPLORE_COMMUNITY_SECOND_SLOT_MIN_VISIBLE_COUNT - 1
    && input.hasActivity
    && input.hasRecommendations
  ) {
    return 'recommendations';
  }

  return null;
}

export function resolveExploreCommunityEmptySlot(
  availability: ExploreCommunityDistributionAvailability
): ExploreCommunityDistributionSlot {
  if (availability.hasActivity) return 'activity';
  return availability.hasRecommendations ? 'recommendations' : null;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
