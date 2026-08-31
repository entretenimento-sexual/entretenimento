// functions/src/community/community-discovery-ranking-mode.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY RANKING MODE POLICY
// -----------------------------------------------------------------------------
// Decide qual campo pode ordenar a descoberta. Score v1 exige solicitação
// explícita, índice declarado como pronto e um ciclo completo de backfill da
// mesma versão. Qualquer dúvida mantém o ranking legado.
// -----------------------------------------------------------------------------

import { COMMUNITY_DISCOVERY_SCORE_VERSION } from './community-ranking.policy';

export type CommunityDiscoveryRankingMode = 'legacy' | 'score_v1';
export type CommunityDiscoveryRankingFallbackReason =
  | 'score_not_requested'
  | 'score_index_not_ready'
  | 'score_backfill_not_ready'
  | 'score_version_mismatch';

export interface CommunityDiscoveryRankingModeDecision {
  requestedMode: CommunityDiscoveryRankingMode;
  effectiveMode: CommunityDiscoveryRankingMode;
  orderField: 'rankScore' | 'discoveryScore';
  scoreVersion: number;
  fallbackReason: CommunityDiscoveryRankingFallbackReason | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

export function resolveCommunityDiscoveryRankingMode(
  rawConfig: unknown,
  rawRuntime: unknown
): CommunityDiscoveryRankingModeDecision {
  const config = asRecord(rawConfig);
  const runtime = asRecord(rawRuntime);
  const requestedMode: CommunityDiscoveryRankingMode =
    config['discoveryRankingMode'] === 'score_v1' ? 'score_v1' : 'legacy';

  if (requestedMode === 'legacy') {
    return {
      requestedMode,
      effectiveMode: 'legacy',
      orderField: 'rankScore',
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      fallbackReason: 'score_not_requested',
    };
  }

  if (config['discoveryScoreIndexReady'] !== true) {
    return {
      requestedMode,
      effectiveMode: 'legacy',
      orderField: 'rankScore',
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      fallbackReason: 'score_index_not_ready',
    };
  }

  if (runtime['ready'] !== true) {
    return {
      requestedMode,
      effectiveMode: 'legacy',
      orderField: 'rankScore',
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      fallbackReason: 'score_backfill_not_ready',
    };
  }

  if (
    Number(runtime['completedScoreVersion'])
      !== COMMUNITY_DISCOVERY_SCORE_VERSION
  ) {
    return {
      requestedMode,
      effectiveMode: 'legacy',
      orderField: 'rankScore',
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      fallbackReason: 'score_version_mismatch',
    };
  }

  return {
    requestedMode,
    effectiveMode: 'score_v1',
    orderField: 'discoveryScore',
    scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    fallbackReason: null,
  };
}
