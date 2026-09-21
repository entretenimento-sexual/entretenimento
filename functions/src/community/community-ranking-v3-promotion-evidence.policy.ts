// functions/src/community/community-ranking-v3-promotion-evidence.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RANKING V3 PROMOTION EVIDENCE
// -----------------------------------------------------------------------------
// v3 só pode sair do shadow com a própria janela de aceitação satisfeita por
// ciclos do scheduler no projeto de produção. Staging/emulator continuam úteis
// para homologação, mas nunca contam como evidência de cutover real.
// -----------------------------------------------------------------------------

import {
  COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
  COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
} from './community-ranking-candidate-v3.policy';
import {
  COMMUNITY_RANKING_V3_ACCEPTANCE_POLICY_VERSION,
  COMMUNITY_RANKING_V3_MIN_CONSECUTIVE_PASSING_CYCLES,
  COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES,
} from './community-ranking-v3-acceptance.policy';
import { COMMUNITY_PRODUCTION_PROJECT_ID } from './community-runtime.guard';

export const COMMUNITY_RANKING_V3_REAL_DATA_OBSERVATION_SOURCE =
  'production_scheduled_runtime' as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function isCommunityRankingV3ProductionEvidenceReady(
  rawShadowRuntime: unknown
): boolean {
  const shadowRuntime = asRecord(rawShadowRuntime);
  const lastEvaluation = asRecord(shadowRuntime['lastEvaluation']);
  const failedCriteria = Array.isArray(lastEvaluation['failedCriteria'])
    ? lastEvaluation['failedCriteria']
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
    : [];

  return shadowRuntime['promotionReady'] === true
    && Number(shadowRuntime['policyVersion'])
      === COMMUNITY_RANKING_V3_ACCEPTANCE_POLICY_VERSION
    && Number(shadowRuntime['candidateScoreVersion'])
      === COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION
    && Number(shadowRuntime['candidateActivityMomentumModelVersion'])
      === COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION
    && normalizeCount(shadowRuntime['observedCycles'])
      >= COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES
    && normalizeCount(shadowRuntime['consecutivePassingCycles'])
      >= COMMUNITY_RANKING_V3_MIN_CONSECUTIVE_PASSING_CYCLES
    && lastEvaluation['accepted'] === true
    && failedCriteria.length === 0
    && normalizeTimestamp(shadowRuntime['lastObservedCycleCompletedAt']) !== null
    && shadowRuntime['realDataQualified'] === true
    && shadowRuntime['observationSource']
      === COMMUNITY_RANKING_V3_REAL_DATA_OBSERVATION_SOURCE
    && shadowRuntime['observedProjectId'] === COMMUNITY_PRODUCTION_PROJECT_ID;
}
