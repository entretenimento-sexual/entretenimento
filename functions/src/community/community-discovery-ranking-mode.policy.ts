// functions/src/community/community-discovery-ranking-mode.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY RANKING MODE POLICY
// -----------------------------------------------------------------------------
// Decide qual campo pode ordenar a descoberta. O modo solicitado carrega a
// própria versão (`score_vN`) e só é ativado quando coincide com a policy atual,
// o índice está declarado pronto e um ciclo completo de backfill terminou na
// mesma versão. Qualquer dúvida mantém o ranking legado para rollback seguro.
// -----------------------------------------------------------------------------

import {
  COMMUNITY_DISCOVERY_RANKING_MODE,
  COMMUNITY_DISCOVERY_SCORE_VERSION,
} from './community-ranking.policy';

export type CommunityDiscoveryScoreRankingMode = `score_v${number}`;
export type CommunityDiscoveryRankingMode =
  | 'legacy'
  | CommunityDiscoveryScoreRankingMode;
export type CommunityDiscoveryRankingFallbackReason =
  | 'score_not_requested'
  | 'score_mode_version_mismatch'
  | 'score_index_not_ready'
  | 'score_backfill_not_ready'
  | 'score_version_mismatch';

export interface CommunityDiscoveryRankingModeDecision {
  requestedMode: CommunityDiscoveryRankingMode;
  effectiveMode: CommunityDiscoveryRankingMode;
  targetMode: typeof COMMUNITY_DISCOVERY_RANKING_MODE;
  orderField: 'rankScore' | 'discoveryScore';
  scoreVersion: number;
  fallbackReason: CommunityDiscoveryRankingFallbackReason | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function normalizeRequestedMode(value: unknown): CommunityDiscoveryRankingMode {
  const normalized = String(value ?? '').trim();
  return /^score_v[1-9]\d*$/.test(normalized)
    ? normalized as CommunityDiscoveryScoreRankingMode
    : 'legacy';
}

function rankingModeScoreVersion(
  mode: CommunityDiscoveryRankingMode
): number | null {
  if (mode === 'legacy') return null;
  const parsed = Math.trunc(Number(mode.slice('score_v'.length)));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function legacyDecision(
  requestedMode: CommunityDiscoveryRankingMode,
  fallbackReason: CommunityDiscoveryRankingFallbackReason
): CommunityDiscoveryRankingModeDecision {
  return {
    requestedMode,
    effectiveMode: 'legacy',
    targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
    orderField: 'rankScore',
    scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    fallbackReason,
  };
}

export function resolveCommunityDiscoveryRankingMode(
  rawConfig: unknown,
  rawRuntime: unknown
): CommunityDiscoveryRankingModeDecision {
  const config = asRecord(rawConfig);
  const runtime = asRecord(rawRuntime);
  const requestedMode = normalizeRequestedMode(config['discoveryRankingMode']);

  if (requestedMode === 'legacy') {
    return legacyDecision(requestedMode, 'score_not_requested');
  }

  if (rankingModeScoreVersion(requestedMode) !== COMMUNITY_DISCOVERY_SCORE_VERSION) {
    return legacyDecision(requestedMode, 'score_mode_version_mismatch');
  }

  if (config['discoveryScoreIndexReady'] !== true) {
    return legacyDecision(requestedMode, 'score_index_not_ready');
  }

  if (runtime['ready'] !== true) {
    return legacyDecision(requestedMode, 'score_backfill_not_ready');
  }

  if (
    Number(runtime['completedScoreVersion'])
      !== COMMUNITY_DISCOVERY_SCORE_VERSION
  ) {
    return legacyDecision(requestedMode, 'score_version_mismatch');
  }

  return {
    requestedMode,
    effectiveMode: requestedMode,
    targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
    orderField: 'discoveryScore',
    scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    fallbackReason: null,
  };
}
