// functions/src/community/community-ranking-rollout.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RANKING ROLLOUT POLICY
// -----------------------------------------------------------------------------
// Centraliza os gates para ativação da versão atual do ranking. A operação nunca
// assume que índice ou backfill estão prontos e mantém rollback explícito para o
// ranking legado durante a janela de observação.
// -----------------------------------------------------------------------------

import {
  COMMUNITY_DISCOVERY_RANKING_MODE,
  COMMUNITY_DISCOVERY_SCORE_VERSION,
} from './community-ranking.policy';

export type CommunityRankingRolloutAction =
  | 'enable_current'
  | 'rollback_legacy';
export type CommunityRankingRolloutDenialReason =
  | 'score_index_not_ready'
  | 'score_backfill_not_ready'
  | 'score_version_mismatch'
  | null;

export interface CommunityRankingRolloutDecision {
  allowed: boolean;
  action: CommunityRankingRolloutAction;
  targetMode: 'legacy' | typeof COMMUNITY_DISCOVERY_RANKING_MODE;
  scoreVersion: number;
  denialReason: CommunityRankingRolloutDenialReason;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function evaluateCommunityRankingRollout(input: {
  action: CommunityRankingRolloutAction;
  rawConfig: unknown;
  rawRuntime: unknown;
}): Readonly<CommunityRankingRolloutDecision> {
  if (input.action === 'rollback_legacy') {
    return {
      allowed: true,
      action: input.action,
      targetMode: 'legacy',
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      denialReason: null,
    };
  }

  const config = asRecord(input.rawConfig);
  const runtime = asRecord(input.rawRuntime);

  if (config['discoveryScoreIndexReady'] !== true) {
    return {
      allowed: false,
      action: input.action,
      targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      denialReason: 'score_index_not_ready',
    };
  }

  if (runtime['ready'] !== true) {
    return {
      allowed: false,
      action: input.action,
      targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      denialReason: 'score_backfill_not_ready',
    };
  }

  if (
    Number(runtime['completedScoreVersion'])
      !== COMMUNITY_DISCOVERY_SCORE_VERSION
  ) {
    return {
      allowed: false,
      action: input.action,
      targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
      scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      denialReason: 'score_version_mismatch',
    };
  }

  return {
    allowed: true,
    action: input.action,
    targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
    scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    denialReason: null,
  };
}
