// src/app/community/discovery/community-contextual-relevance.ts
// -----------------------------------------------------------------------------
// COMMUNITY CONTEXTUAL RELEVANCE
// -----------------------------------------------------------------------------
// Camada de apresentação derivada e efêmera. Não altera `discoveryScore`, não é
// persistida no Firestore e não entra no cache orgânico. A ordem recebida do
// backend é canônica e deve permanecer intacta entre páginas; afinidade local
// serve apenas para explicar por que um card pode ser relevante ao viewer.
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
  /** Metadado local explicativo; nunca participa da ordenação ou paginação. */
  readonly rank: number;
  readonly explicitPreferenceRank: number;
  readonly sessionBehaviorRank: number;
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

function sessionBehaviorRank(
  signal: Readonly<CommunityDiscoverySessionSignal> | undefined
): number {
  if (!signal) return 0;

  // Mantido somente como metadado explicativo/experimental. Ele não pode mover
  // um card dentro da página nem competir com o ranking canônico do backend.
  if (signal.memberActive) return 2;
  if (signal.meaningfulOpenCount >= 4) return 2;
  if (signal.meaningfulOpenCount >= 2) return 1;
  return 0;
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

/**
 * Compatibilidade de API com a apresentação existente.
 *
 * O backend define integralmente a ordem da descoberta e o cursor que continua
 * essa ordem. O cliente pode ocultar um card por decisão efêmera do próprio
 * viewer e anexar metadados contextuais, mas nunca reordenar os sobreviventes.
 */
export function personalizeCommunityDiscoveryCards(
  items: readonly CommunityPreviewCard[],
  catalog: readonly CommunityTagDefinition[],
  profile: Readonly<PreferenceProfile> | null,
  sessionBehavior?: Readonly<CommunityDiscoverySessionBehaviorState>
): readonly CommunityContextualPreviewCard[] {
  const hidden = new Set(sessionBehavior?.hiddenCommunityIds ?? []);

  return items
    .filter((item) => !hidden.has(item.communityId))
    .map((item) => ({
      ...item,
      contextualRelevance: resolveCommunityCombinedRelevance(
        item,
        catalog,
        profile,
        sessionBehavior?.signals[item.communityId]
      ),
    } satisfies CommunityContextualPreviewCard));
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
