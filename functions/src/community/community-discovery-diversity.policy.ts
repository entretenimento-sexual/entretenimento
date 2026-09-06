// functions/src/community/community-discovery-diversity.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY DIVERSITY POLICY
// -----------------------------------------------------------------------------
// Reordena somente a página já autorizada/sanitizada da descoberta para evitar
// sequências excessivas do mesmo recorte editorial. Não altera score, cursor,
// elegibilidade, memberships nem consulta dados adicionais. A política é
// determinística e preserva todos os cards exatamente uma vez.
// -----------------------------------------------------------------------------

import type { CommunityPreviewCard } from './community-preview.model';

const MAX_CONSECUTIVE_BUCKET = 2;
const DIVERSITY_LOOKAHEAD = 4;

function resolveDiversityBucket(item: CommunityPreviewCard): string {
  if (item.source.type === 'community') {
    const primaryTagId = item.tags[0]?.id ?? null;
    return primaryTagId
      ? `community:tag:${primaryTagId}`
      : 'community:untagged';
  }

  return `source:${item.source.type}`;
}

export function diversifyCommunityDiscoveryPage(
  items: readonly CommunityPreviewCard[]
): CommunityPreviewCard[] {
  if (items.length <= MAX_CONSECUTIVE_BUCKET) {
    return [...items];
  }

  const remaining = [...items];
  const result: CommunityPreviewCard[] = [];
  let previousBucket: string | null = null;
  let consecutive = 0;

  while (remaining.length > 0) {
    let selectedIndex = 0;
    const headBucket = resolveDiversityBucket(remaining[0]);

    if (
      previousBucket !== null
      && headBucket === previousBucket
      && consecutive >= MAX_CONSECUTIVE_BUCKET
    ) {
      const maxIndex = Math.min(DIVERSITY_LOOKAHEAD, remaining.length - 1);

      for (let index = 1; index <= maxIndex; index += 1) {
        if (resolveDiversityBucket(remaining[index]) !== previousBucket) {
          selectedIndex = index;
          break;
        }
      }
    }

    const selected = remaining.splice(selectedIndex, 1)[0];
    if (!selected) break;

    const selectedBucket = resolveDiversityBucket(selected);
    if (selectedBucket === previousBucket) {
      consecutive += 1;
    } else {
      previousBucket = selectedBucket;
      consecutive = 1;
    }

    result.push(selected);
  }

  return result;
}
