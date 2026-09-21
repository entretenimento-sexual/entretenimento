// functions/src/community/community-discovery-ranking-mode.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY RANKING MODE POLICY
// -----------------------------------------------------------------------------
// Resolve exclusivamente a configuração canônica backend. v3 permanece shadow
// até índice, runtime candidato e janela mensurável de aceitação estarem prontos.
// Qualquer inconsistência falha fechado para v2 (quando pronto) ou legacy.
// -----------------------------------------------------------------------------

import {
  COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
  COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
} from './community-ranking-candidate-v3.policy';
import {
  COMMUNITY_DISCOVERY_RANKING_MODE,
  COMMUNITY_DISCOVERY_SCORE_VERSION,
} from './community-ranking.policy';
import {
  isCommunityRankingV3ProductionEvidenceReady,
} from './community-ranking-v3-promotion-evidence.policy';

export const COMMUNITY_DISCOVERY_V3_RANKING_MODE =
  `score_v${COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION}` as const;

export type CommunityDiscoveryScoreRankingMode = `score_v${number}`;
export type CommunityDiscoveryRankingMode =
  | 'legacy'
  | CommunityDiscoveryScoreRankingMode;
export type CommunityDiscoveryRankingOrderField =
  | 'rankScore'
  | 'discoveryScore'
  | 'rankingCandidate.discoveryScore';
export type CommunityDiscoveryRankingFallbackReason =
  | 'score_not_requested'
  | 'score_mode_version_mismatch'
  | 'score_index_not_ready'
  | 'score_backfill_not_ready'
  | 'score_version_mismatch'
  | 'candidate_index_not_ready'
  | 'candidate_runtime_not_ready'
  | 'candidate_shadow_acceptance_not_ready'
  | 'candidate_real_data_not_ready';

export interface CommunityDiscoveryRankingModeDecision {
  requestedMode: CommunityDiscoveryRankingMode;
  effectiveMode: CommunityDiscoveryRankingMode;
  targetMode:
    | typeof COMMUNITY_DISCOVERY_RANKING_MODE
    | typeof COMMUNITY_DISCOVERY_V3_RANKING_MODE;
  orderField: CommunityDiscoveryRankingOrderField;
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

function v2Ready(
  config: Record<string, unknown>,
  runtime: Record<string, unknown>
): CommunityDiscoveryRankingFallbackReason | null {
  if (config['discoveryScoreIndexReady'] !== true) {
    return 'score_index_not_ready';
  }
  if (runtime['ready'] !== true) {
    return 'score_backfill_not_ready';
  }
  if (
    Number(runtime['completedScoreVersion'])
      !== COMMUNITY_DISCOVERY_SCORE_VERSION
  ) {
    return 'score_version_mismatch';
  }
  return null;
}

function fallbackDecision(
  requestedMode: CommunityDiscoveryRankingMode,
  reason: CommunityDiscoveryRankingFallbackReason,
  config: Record<string, unknown>,
  runtime: Record<string, unknown>
): CommunityDiscoveryRankingModeDecision {
  const v2FallbackReady = v2Ready(config, runtime) === null;

  return {
    requestedMode,
    effectiveMode: v2FallbackReady
      ? COMMUNITY_DISCOVERY_RANKING_MODE
      : 'legacy',
    targetMode: requestedMode === COMMUNITY_DISCOVERY_V3_RANKING_MODE
      ? COMMUNITY_DISCOVERY_V3_RANKING_MODE
      : COMMUNITY_DISCOVERY_RANKING_MODE,
    orderField: v2FallbackReady ? 'discoveryScore' : 'rankScore',
    scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    fallbackReason: reason,
  };
}

export function resolveCommunityDiscoveryRankingMode(
  rawConfig: unknown,
  rawRuntime: unknown,
  rawShadowRuntime: unknown = null
): CommunityDiscoveryRankingModeDecision {
  const config = asRecord(rawConfig);
  const runtime = asRecord(rawRuntime);
  const shadowRuntime = asRecord(rawShadowRuntime);
  const requestedMode = normalizeRequestedMode(config['discoveryRankingMode']);

  if (requestedMode === 'legacy') {
    return {
      requestedMode,
      effectiveMode: 'legacy',
      targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
      orderField: 'rankScore',
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      fallbackReason: 'score_not_requested',
    };
  }

  const requestedVersion = rankingModeScoreVersion(requestedMode);
  if (
    requestedVersion !== COMMUNITY_DISCOVERY_SCORE_VERSION
    && requestedVersion !== COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION
  ) {
    return {
      requestedMode,
      effectiveMode: 'legacy',
      targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
      orderField: 'rankScore',
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      fallbackReason: 'score_mode_version_mismatch',
    };
  }

  const v2Denial = v2Ready(config, runtime);
  if (v2Denial) {
    return fallbackDecision(requestedMode, v2Denial, config, runtime);
  }

  if (requestedVersion === COMMUNITY_DISCOVERY_SCORE_VERSION) {
    return {
      requestedMode,
      effectiveMode: COMMUNITY_DISCOVERY_RANKING_MODE,
      targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
      orderField: 'discoveryScore',
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      fallbackReason: null,
    };
  }

  if (config['discoveryCandidateV3IndexReady'] !== true) {
    return fallbackDecision(
      requestedMode,
      'candidate_index_not_ready',
      config,
      runtime
    );
  }

  if (
    Number(runtime['completedCandidateActivityMomentumModelVersion'])
      !== COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION
  ) {
    return fallbackDecision(
      requestedMode,
      'candidate_runtime_not_ready',
      config,
      runtime
    );
  }

  if (
    Number(shadowRuntime['candidateScoreVersion'])
      !== COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION
    || shadowRuntime['promotionReady'] !== true
  ) {
    return fallbackDecision(
      requestedMode,
      'candidate_shadow_acceptance_not_ready',
      config,
      runtime
    );
  }

  if (!isCommunityRankingV3ProductionEvidenceReady(shadowRuntime)) {
    return fallbackDecision(
      requestedMode,
      'candidate_real_data_not_ready',
      config,
      runtime
    );
  }

  return {
    requestedMode,
    effectiveMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
    targetMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
    orderField: 'rankingCandidate.discoveryScore',
    scoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
    fallbackReason: null,
  };
}
