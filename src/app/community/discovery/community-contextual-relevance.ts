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
import type {
  CommunityDiscoverySessionBehaviorState,
  CommunityDiscoverySessionSignal,
} from './community-discovery-session-behavior.service';

export interface CommunityContextualMatch {
  readonly tagId: string;
  readonly label: string;
  readonly category: CommunityTagDefinition['category'];
}

export interface CommunityContextualRelevance {
  /** Peso interno de ordenação contextual; nunca deve ser mostrado como score. */
  readonly rank: number;
  readonly explicitPreferenceRank: number;
  readonly sessionBehaviorRank: number;
  readonly matches: readonly CommunityContextualMatch[];
}

export type CommunityContextualPreviewCard = CommunityPreviewCard & {
  readonly contextualRelevance: CommunityContextualRelevance | null;
};

interface ContextualCandidate {
  readonly card: CommunityContextualPreviewCard;
}

const SIGNAL_WEIGHTS: Readonly<Record<CommunityPreferenceSignalDomain, number>> =
  Object.freeze({
    relationshipIntent: 4,
    sexualPractice: 3,
    genderInterest: 2,
  });

const CONTEXTUAL_CANDIDATE_WINDOW = 4;
const ORGANIC_ANCHOR_INTERVAL = 4;
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

function sessionBehaviorRank(
  signal: Readonly<CommunityDiscoverySessionSignal> | undefined
): number {
  if (!signal) return 0;

  // O comportamento nunca supera sozinho uma preferência explícita forte.
  if (signal.memberActive) return 2;
  if (signal.meaningfulOpenCount >= 4) return 2;
  if (signal.meaningfulOpenCount >= 2) return 1;
  return 0;
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
  return resolveCommunityCombinedRelevance(card, catalog, profile, undefined);
}

function resolveCommunityCombinedRelevance(
  card: Readonly<CommunityPreviewCard>,
  catalog: readonly CommunityTagDefinition[],
  profile: Readonly<PreferenceProfile> | null,
  sessionSignal: Readonly<CommunityDiscoverySessionSignal> | undefined
): CommunityContextualRelevance | null {
  const catalogById = new Map(catalog.map((tag) => [tag.id, tag] as const));
  const matches: CommunityContextualMatch[] = [];
  let explicitPreferenceRank = 0;

  if (profile) {
    for (const cardTag of card.tags) {
      const definition = catalogById.get(cardTag.id);
      const matchingSignals = (definition?.preferenceSignals ?? []).filter(
        (signal) => signalMatchesProfile(signal, profile)
      );

      if (!definition || matchingSignals.length === 0) continue;

      explicitPreferenceRank += Math.max(
        ...matchingSignals.map((signal) => SIGNAL_WEIGHTS[signal.domain])
      );
      matches.push({
        tagId: definition.id,
        label: definition.label,
        category: definition.category,
      });
    }
  }

  const behaviorRank = sessionBehaviorRank(sessionSignal);
  const rank = explicitPreferenceRank + behaviorRank;

  return rank > 0
    ? {
        rank,
        explicitPreferenceRank,
        sessionBehaviorRank: behaviorRank,
        matches,
      }
    : null;
}

export function personalizeCommunityDiscoveryCards(
  items: readonly CommunityPreviewCard[],
  catalog: readonly CommunityTagDefinition[],
  profile: Readonly<PreferenceProfile> | null,
  sessionBehavior?: Readonly<CommunityDiscoverySessionBehaviorState>
): readonly CommunityContextualPreviewCard[] {
  const hidden = new Set(sessionBehavior?.hiddenCommunityIds ?? []);
  const remaining: ContextualCandidate[] = items
    .filter((item) => !hidden.has(item.communityId))
    .map((item) => ({
      card: {
        ...item,
        contextualRelevance: resolveCommunityCombinedRelevance(
          item,
          catalog,
          profile,
          sessionBehavior?.signals[item.communityId]
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
