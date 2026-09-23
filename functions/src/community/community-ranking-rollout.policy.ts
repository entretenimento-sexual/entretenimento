// functions/src/community/community-ranking-rollout.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RANKING ROLLOUT POLICY
// -----------------------------------------------------------------------------
// Cutover canônico de ranking. Durante OBSERVE_ONLY, v3 permanece shadow mesmo
// que a evidência técnica já esteja pronta. Rollback para v2/legacy continua
// explícito e disponível.
// -----------------------------------------------------------------------------

import {
  isCommunityCalibrationChangeAllowed,
} from './community-calibration-stage.policy';
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

export type CommunityRankingRolloutAction =
  | 'enable_current'
  | 'promote_v3'
  | 'rollback_v2'
  | 'rollback_legacy';

export type CommunityRankingRolloutDenialReason =
  | 'score_index_not_ready'
  | 'score_backfill_not_ready'
  | 'score_version_mismatch'
  | 'candidate_index_not_ready'
  | 'candidate_runtime_not_ready'
  | 'candidate_shadow_acceptance_not_ready'
  | 'candidate_real_data_not_ready'
  | 'calibration_observation_only'
  | null;

export interface CommunityRankingRolloutDecision {
  allowed: boolean;
  action: CommunityRankingRolloutAction;
  targetMode:
    | 'legacy'
    | typeof COMMUNITY_DISCOVERY_RANKING_MODE
    | typeof COMMUNITY_DISCOVERY_V3_RANKING_MODE;
  scoreVersion: number;
  denialReason: CommunityRankingRolloutDenialReason;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function v2Ready(
  config: Record<string, unknown>,
  runtime: Record<string, unknown>
) {
  if (config['discoveryScoreIndexReady'] !== true) {
    return 'score_index_not_ready' as const;
  }
  if (runtime['ready'] !== true) {
    return 'score_backfill_not_ready' as const;
  }
  if (
    Number(runtime['completedScoreVersion'])
      !== COMMUNITY_DISCOVERY_SCORE_VERSION
  ) {
    return 'score_version_mismatch' as const;
  }
  return null;
}

export function evaluateCommunityRankingRollout(input: {
  action: CommunityRankingRolloutAction;
  rawConfig: unknown;
  rawRuntime: unknown;
  rawShadowRuntime?: unknown;
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
  const shadowRuntime = asRecord(input.rawShadowRuntime);
  const v2Denial = v2Ready(config, runtime);

  if (input.action === 'enable_current' || input.action === 'rollback_v2') {
    if (v2Denial) {
      return {
        allowed: false,
        action: input.action,
        targetMode: COMMUNITY_DISCOVERY_RANKING_MODE,
        scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
        denialReason: v2Denial,
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

  // promote_v3 é deliberadamente impossível durante OBSERVE_ONLY.
  if (!isCommunityCalibrationChangeAllowed()) {
    return {
      allowed: false,
      action: input.action,
      targetMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
      scoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      denialReason: 'calibration_observation_only',
    };
  }

  if (v2Denial) {
    return {
      allowed: false,
      action: input.action,
      targetMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
      scoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      denialReason: v2Denial,
    };
  }

  if (config['discoveryCandidateV3IndexReady'] !== true) {
    return {
      allowed: false,
      action: input.action,
      targetMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
      scoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      denialReason: 'candidate_index_not_ready',
    };
  }

  if (
    Number(runtime['completedCandidateActivityMomentumModelVersion'])
      !== COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION
  ) {
    return {
      allowed: false,
      action: input.action,
      targetMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
      scoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      denialReason: 'candidate_runtime_not_ready',
    };
  }

  if (
    Number(shadowRuntime['candidateScoreVersion'])
      !== COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION
    || shadowRuntime['promotionReady'] !== true
  ) {
    return {
      allowed: false,
      action: input.action,
      targetMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
      scoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      denialReason: 'candidate_shadow_acceptance_not_ready',
    };
  }

  if (!isCommunityRankingV3ProductionEvidenceReady(shadowRuntime)) {
    return {
      allowed: false,
      action: input.action,
      targetMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
      scoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      denialReason: 'candidate_real_data_not_ready',
    };
  }

  return {
    allowed: true,
    action: input.action,
    targetMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
    scoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
    denialReason: null,
  };
}
