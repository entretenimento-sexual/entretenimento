// functions/src/community/community-discovery-ranking-mode.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_DISCOVERY_RANKING_MODE,
  COMMUNITY_DISCOVERY_SCORE_VERSION,
} from './community-ranking.policy';
import {
  COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
  COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
} from './community-ranking-candidate-v3.policy';
import {
  COMMUNITY_DISCOVERY_V3_RANKING_MODE,
  resolveCommunityDiscoveryRankingMode,
} from './community-discovery-ranking-mode.policy';
import {
  COMMUNITY_RANKING_V3_ACCEPTANCE_POLICY_VERSION,
  COMMUNITY_RANKING_V3_MIN_CONSECUTIVE_PASSING_CYCLES,
  COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES,
} from './community-ranking-v3-acceptance.policy';
import {
  COMMUNITY_RANKING_V3_REAL_DATA_OBSERVATION_SOURCE,
} from './community-ranking-v3-promotion-evidence.policy';
import { COMMUNITY_PRODUCTION_PROJECT_ID } from './community-runtime.guard';

test('mantém ranking legado por padrão', () => {
  const decision = resolveCommunityDiscoveryRankingMode({}, {});

  assert.equal(decision.targetMode, COMMUNITY_DISCOVERY_RANKING_MODE);
  assert.equal(decision.effectiveMode, 'legacy');
  assert.equal(decision.orderField, 'rankScore');
  assert.equal(decision.fallbackReason, 'score_not_requested');
});

test('modo de score anterior não ativa uma fórmula nova por acidente', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    {
      discoveryRankingMode: 'score_v1',
      discoveryScoreIndexReady: true,
    },
    {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    }
  );

  assert.equal(decision.requestedMode, 'score_v1');
  assert.equal(decision.effectiveMode, 'legacy');
  assert.equal(decision.fallbackReason, 'score_mode_version_mismatch');
});

test('não ativa score atual sem índice explicitamente pronto', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    { discoveryRankingMode: COMMUNITY_DISCOVERY_RANKING_MODE },
    {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    }
  );

  assert.equal(decision.effectiveMode, 'legacy');
  assert.equal(decision.fallbackReason, 'score_index_not_ready');
});

test('não ativa score atual sem ciclo completo de backfill', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    {
      discoveryRankingMode: COMMUNITY_DISCOVERY_RANKING_MODE,
      discoveryScoreIndexReady: true,
    },
    { ready: false }
  );

  assert.equal(decision.effectiveMode, 'legacy');
  assert.equal(decision.fallbackReason, 'score_backfill_not_ready');
});

test('não ativa score de runtime diferente da política atual', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    {
      discoveryRankingMode: COMMUNITY_DISCOVERY_RANKING_MODE,
      discoveryScoreIndexReady: true,
    },
    {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION + 1,
    }
  );

  assert.equal(decision.effectiveMode, 'legacy');
  assert.equal(decision.fallbackReason, 'score_version_mismatch');
});

test('ativa score v2 somente quando todos os gates estão prontos', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    {
      discoveryRankingMode: COMMUNITY_DISCOVERY_RANKING_MODE,
      discoveryScoreIndexReady: true,
    },
    {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    }
  );

  assert.equal(decision.effectiveMode, COMMUNITY_DISCOVERY_RANKING_MODE);
  assert.equal(decision.orderField, 'discoveryScore');
  assert.equal(decision.fallbackReason, null);
});


test('config score_v3 sem aceitação permanece servindo v2', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    {
      discoveryRankingMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
      discoveryScoreIndexReady: true,
      discoveryCandidateV3IndexReady: true,
    },
    {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      completedCandidateActivityMomentumModelVersion:
        COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
    },
    {
      candidateScoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      promotionReady: false,
    }
  );

  assert.equal(decision.effectiveMode, COMMUNITY_DISCOVERY_RANKING_MODE);
  assert.equal(decision.orderField, 'discoveryScore');
  assert.equal(decision.fallbackReason, 'candidate_shadow_acceptance_not_ready');
});

test('score_v3 com promotionReady sem dados reais continua servindo v2', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    {
      discoveryRankingMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
      discoveryScoreIndexReady: true,
      discoveryCandidateV3IndexReady: true,
    },
    {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      completedCandidateActivityMomentumModelVersion:
        COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
    },
    {
      candidateScoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      promotionReady: true,
    }
  );

  assert.equal(decision.effectiveMode, COMMUNITY_DISCOVERY_RANKING_MODE);
  assert.equal(decision.orderField, 'discoveryScore');
  assert.equal(decision.fallbackReason, 'candidate_real_data_not_ready');
});

test('score_v3 só vira efetivo depois de todos os gates canônicos', () => {
  const decision = resolveCommunityDiscoveryRankingMode(
    {
      discoveryRankingMode: COMMUNITY_DISCOVERY_V3_RANKING_MODE,
      discoveryScoreIndexReady: true,
      discoveryCandidateV3IndexReady: true,
    },
    {
      ready: true,
      completedScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      completedCandidateActivityMomentumModelVersion:
        COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
    },
    {
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
    }
  );

  assert.equal(decision.effectiveMode, COMMUNITY_DISCOVERY_V3_RANKING_MODE);
  assert.equal(decision.orderField, 'rankingCandidate.discoveryScore');
  assert.equal(decision.scoreVersion, COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION);
  assert.equal(decision.fallbackReason, null);
});
