// src/app/community/discovery/community-contextual-relevance.ts
// -----------------------------------------------------------------------------
// COMMUNITY CONTEXTUAL RELEVANCE
// -----------------------------------------------------------------------------
// Camada de apresentação derivada e efêmera. Não altera `discoveryScore`, não é
// persistida no Firestore e não entra no cache orgânico. A ordem original da
// página continua sendo a autoridade de qualidade e paginação do backend.
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

interface ContextualCandidate {
  readonly organicIndex: number;
  readonly card: CommunityContextualPreviewCard;
}

const SIGNAL_WEIGHTS: Readonly<Record<CommunityPreferenceSignalDomain, number>> =
  Object.freeze({
    relationshipIntent: 4,
    sexualPractice: 3,
    genderInterest: 2,
  });

/**
 * A personalização só olha os quatro próximos cards orgânicos. Assim nenhum
 * item atravessa a página inteira por afinidade privada e a posição autoritativa
 * do backend continua exercendo forte influência na apresentação.
 */
const CONTEXTUAL_CANDIDATE_WINDOW = 4;

/**
 * A cada quatro posições, a primeira comunidade ainda não apresentada na ordem
 * orgânica vira uma âncora. Isso reserva 25% da sequência para qualidade,
 * frescor e exploração que já foram calculados pelo ranking backend.
 */
const ORGANIC_ANCHOR_INTERVAL = 4;

/** Penaliza repetição imediata sem transformar diversidade em filtro rígido. */
const CONTEXTUAL_DIVERSITY_LOOKBACK = 2;

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

function recentContextualTagIds(
  selected: readonly ContextualCandidate[]
): ReadonlySet<string> {
  const recentTags = new Set<string>();

  for (const candidate of selected.slice(-CONTEXTUAL_DIVERSITY_LOOKBACK)) {
    for (const match of candidate.card.contextualRelevance?.matches ?? []) {
      recentTags.add(match.tagId);
    }
  }

  return recentTags;
}

function contextualSelectionRank(
  candidate: Readonly<ContextualCandidate>,
  recentTags: ReadonlySet<string>
): { adjustedRank: number; novelMatches: number } {
  const relevance = candidate.card.contextualRelevance;
  if (!relevance) return { adjustedRank: 0, novelMatches: 0 };

  const repeatedMatches = relevance.matches.filter((match) =>
    recentTags.has(match.tagId)
  ).length;
  const novelMatches = relevance.matches.length - repeatedMatches;

  return {
    adjustedRank: Math.max(0, relevance.rank - repeatedMatches),
    novelMatches,
  };
}

function chooseContextualCandidateIndex(
  remaining: readonly ContextualCandidate[],
  selected: readonly ContextualCandidate[],
  targetIndex: number
): number {
  if (
    targetIndex % ORGANIC_ANCHOR_INTERVAL === 0
    || remaining.length <= 1
  ) {
    return 0;
  }

  const recentTags = recentContextualTagIds(selected);
  const candidateWindow = remaining.slice(0, CONTEXTUAL_CANDIDATE_WINDOW);
  let bestWindowIndex = 0;
  let bestRank = contextualSelectionRank(candidateWindow[0], recentTags);

  for (let index = 1; index < candidateWindow.length; index += 1) {
    const currentRank = contextualSelectionRank(candidateWindow[index], recentTags);

    if (
      currentRank.adjustedRank > bestRank.adjustedRank
      || (
        currentRank.adjustedRank === bestRank.adjustedRank
        && currentRank.novelMatches > bestRank.novelMatches
      )
    ) {
      bestWindowIndex = index;
      bestRank = currentRank;
    }
  }

  return bestWindowIndex;
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
  const remaining: ContextualCandidate[] = items.map((item, organicIndex) => ({
    organicIndex,
    card: {
      ...item,
      contextualRelevance: resolveCommunityContextualRelevance(
        item,
        catalog,
        profile
      ),
    } satisfies CommunityContextualPreviewCard,
  }));
  const selected: ContextualCandidate[] = [];

  while (remaining.length > 0) {
    const candidateIndex = chooseContextualCandidateIndex(
      remaining,
      selected,
      selected.length
    );
    const [candidate] = remaining.splice(candidateIndex, 1);
    selected.push(candidate);
  }

  return selected.map(({ card }) => card);
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
