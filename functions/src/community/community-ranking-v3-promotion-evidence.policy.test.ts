import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
  COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
} from './community-ranking-candidate-v3.policy';
import {
  COMMUNITY_RANKING_V3_ACCEPTANCE_POLICY_VERSION,
  COMMUNITY_RANKING_V3_MIN_CONSECUTIVE_PASSING_CYCLES,
  COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES,
} from './community-ranking-v3-acceptance.policy';
import {
  COMMUNITY_RANKING_V3_REAL_DATA_OBSERVATION_SOURCE,
  isCommunityRankingV3ProductionEvidenceReady,
} from './community-ranking-v3-promotion-evidence.policy';
import { COMMUNITY_PRODUCTION_PROJECT_ID } from './community-runtime.guard';

function readyEvidence(overrides: Record<string, unknown> = {}) {
  return {
    policyVersion: COMMUNITY_RANKING_V3_ACCEPTANCE_POLICY_VERSION,
    candidateScoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
    candidateActivityMomentumModelVersion:
      COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
    observedCycles: COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES,
    consecutivePassingCycles:
      COMMUNITY_RANKING_V3_MIN_CONSECUTIVE_PASSING_CYCLES,
    promotionReady: true,
    lastObservedCycleCompletedAt: Date.UTC(2026, 8, 21, 6, 25, 0),
    lastEvaluation: {
      accepted: true,
      failedCriteria: [],
    },
    realDataQualified: true,
    observationSource: COMMUNITY_RANKING_V3_REAL_DATA_OBSERVATION_SOURCE,
    observedProjectId: COMMUNITY_PRODUCTION_PROJECT_ID,
    ...overrides,
  };
}

test('aceita somente evidência completa do scheduler de produção', () => {
  assert.equal(
    isCommunityRankingV3ProductionEvidenceReady(readyEvidence()),
    true
  );
});

test('promotionReady isolado não substitui a janela mensurável', () => {
  assert.equal(
    isCommunityRankingV3ProductionEvidenceReady(readyEvidence({
      observedCycles: COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES - 1,
    })),
    false
  );
});

test('staging/emulator nunca qualificam o cutover v3', () => {
  assert.equal(
    isCommunityRankingV3ProductionEvidenceReady(readyEvidence({
      realDataQualified: false,
      observationSource: 'non_production_scheduled_runtime',
      observedProjectId: 'entretenimento-staging',
    })),
    false
  );
});
