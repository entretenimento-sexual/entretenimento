// src/app/community/discovery/community-contextual-relevance.ts
// -----------------------------------------------------------------------------
// COMMUNITY CONTEXTUAL RELEVANCE
// -----------------------------------------------------------------------------
// Camada de apresentação derivada e efêmera. Não altera `discoveryScore`, não é
// persistida no Firestore e não entra no cache orgânico. A ordem original da
// página continua sendo o desempate, preservando o ranking autoritativo backend.
// -----------------------------------------------------------------------------

import type { PreferenceProfile } from 'src/app/preferences/models/preference-profile.model';
import type { CommunityPreviewCard } from '../data-access/community-preview.model';
import type {
  CommunityPreferenceSignal,
  CommunityPreferenceSignalDomain,
  CommunityTagDefinition,
} from '../data-access/community-tag.model';

export interface CommunityContextualMatch {
  readonly tagId: string;
  readonly label: string;
  readonly category: CommunityTagDefinition['category'];
}

export interface CommunityContextualRelevance {
  /** Peso interno de ordenação contextual; nunca deve ser mostrado como score. */
  readonly rank: number;
  readonly matches: readonly CommunityContextualMatch[];
}

export type CommunityContextualPreviewCard = CommunityPreviewCard & {
  readonly contextualRelevance: CommunityContextualRelevance | null;
};

const SIGNAL_WEIGHTS: Readonly<Record<CommunityPreferenceSignalDomain, number>> =
  Object.freeze({
    relationshipIntent: 4,
    sexualPractice: 3,
    genderInterest: 2,
  });

function signalMatchesProfile(
  signal: Readonly<CommunityPreferenceSignal>,
  profile: Readonly<PreferenceProfile>
): boolean {
  if (signal.domain === 'relationshipIntent') {
    return profile.relationshipIntents.some((value) => value === signal.key);
  }

  if (signal.domain === 'sexualPractice') {
    return profile.softRules.sexualPractices.some((value) => value === signal.key);
  }

  return profile.hardRules.acceptedGenders.some((value) => value === signal.key);
}

export function resolveCommunityContextualRelevance(
  card: Readonly<CommunityPreviewCard>,
  catalog: readonly CommunityTagDefinition[],
  profile: Readonly<PreferenceProfile>
): CommunityContextualRelevance | null {
  const catalogById = new Map(catalog.map((tag) => [tag.id, tag] as const));
  const matches: CommunityContextualMatch[] = [];
  let rank = 0;

  for (const cardTag of card.tags) {
    const definition = catalogById.get(cardTag.id);
    const matchingSignals = (definition?.preferenceSignals ?? []).filter(
      (signal) => signalMatchesProfile(signal, profile)
    );

    if (!definition || matchingSignals.length === 0) continue;

    // Uma tag que representa mais de um domínio (ex.: Swing) conta apenas uma
    // vez. O maior peso sinaliza a afinidade mais forte sem inflar o resultado.
    rank += Math.max(
      ...matchingSignals.map((signal) => SIGNAL_WEIGHTS[signal.domain])
    );
    matches.push({
      tagId: definition.id,
      label: definition.label,
      category: definition.category,
    });
  }

  return rank > 0 && matches.length > 0
    ? { rank, matches }
    : null;
}

export function personalizeCommunityDiscoveryCards(
  items: readonly CommunityPreviewCard[],
  catalog: readonly CommunityTagDefinition[],
  profile: Readonly<PreferenceProfile>
): readonly CommunityContextualPreviewCard[] {
  return items
    .map((item, organicIndex) => ({
      organicIndex,
      card: {
        ...item,
        contextualRelevance: resolveCommunityContextualRelevance(
          item,
          catalog,
          profile
        ),
      } satisfies CommunityContextualPreviewCard,
    }))
    .sort((left, right) => {
      const relevanceDifference =
        (right.card.contextualRelevance?.rank ?? 0)
        - (left.card.contextualRelevance?.rank ?? 0);

      return relevanceDifference !== 0
        ? relevanceDifference
        : left.organicIndex - right.organicIndex;
    })
    .map(({ card }) => card);
}

export function communityContextualMatchLabel(
  item: Readonly<CommunityPreviewCard>
): string | null {
  const relevance = (item as CommunityContextualPreviewCard).contextualRelevance;
  const count = relevance?.matches.length ?? 0;

  if (count <= 0) return null;
  return count === 1
    ? 'Combina com 1 interesse seu'
    : `Combina com ${count} interesses seus`;
}
