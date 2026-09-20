import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_RANKING_V3_MIN_CONSECUTIVE_PASSING_CYCLES,
  COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES,
  advanceCommunityRankingV3AcceptanceState,
  evaluateCommunityRankingV3Acceptance,
} from './community-ranking-v3-acceptance.policy';
import type {
  CommunityRankingShadowDiagnostics,
} from './community-ranking-shadow-diagnostics.policy';

function diagnostics(
  overrides: Partial<CommunityRankingShadowDiagnostics> = {}
): CommunityRankingShadowDiagnostics {
  return {
    topK: 25,
    comparisonDepth: 25,
    officialTopCount: 25,
    candidateTopCount: 25,
    overlapCount: 20,
    overlapRate: 80,
    rankAgreement: 88,
    meanAbsoluteRankShift: 3,
    maxAbsoluteRankShift: 10,
    candidateEntrants: 5,
    candidateExits: 5,
    meanCandidateScoreDelta: 2,
    coldStart: {
      windowDays: 30,
      officialKnownAgeCount: 25,
      candidateKnownAgeCount: 25,
      officialAgeCoverageRate: 100,
      candidateAgeCoverageRate: 100,
      officialNewCount: 2,
      candidateNewCount: 3,
      officialNewShare: 8,
      candidateNewShare: 12,
      newShareDelta: 4,
    },
    ...overrides,
  };
}

test('aprova somente snapshot shadow dentro de todos os limites mensuráveis', () => {
  assert.deepEqual(evaluateCommunityRankingV3Acceptance(diagnostics()), {
    accepted: true,
    failedCriteria: [],
  });
});

test('expõe critérios reprovados sem transformar um score único em verdict', () => {
  const result = evaluateCommunityRankingV3Acceptance(diagnostics({
    overlapRate: 40,
    rankAgreement: 60,
    meanAbsoluteRankShift: 9,
    maxAbsoluteRankShift: 22,
    coldStart: {
      ...diagnostics().coldStart,
      candidateAgeCoverageRate: 70,
      newShareDelta: 30,
    },
  }));

  assert.equal(result.accepted, false);
  assert.deepEqual(result.failedCriteria, [
    'overlap_rate',
    'rank_agreement',
    'mean_absolute_rank_shift',
    'max_absolute_rank_shift',
    'candidate_age_coverage',
    'new_share_delta',
  ]);
});

test('um snapshot isolado nunca deixa v3 pronto para promoção', () => {
  const state = advanceCommunityRankingV3AcceptanceState({
    previous: null,
    diagnostics: diagnostics(),
    cycleCompletedAt: 1_000,
  });

  assert.equal(state.observedCycles, 1);
  assert.equal(state.consecutivePassingCycles, 1);
  assert.equal(state.promotionReady, false);
});

test('promoção exige janela mínima e aprovações consecutivas no fim da janela', () => {
  let state: unknown = null;

  for (let cycle = 1; cycle <= COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES; cycle += 1) {
    state = advanceCommunityRankingV3AcceptanceState({
      previous: state,
      diagnostics: diagnostics(),
      cycleCompletedAt: cycle * 1_000,
    });
  }

  const finalState = state as ReturnType<
    typeof advanceCommunityRankingV3AcceptanceState
  >;

  assert.equal(
    finalState.observedCycles,
    COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES
  );
  assert.equal(
    finalState.consecutivePassingCycles
      >= COMMUNITY_RANKING_V3_MIN_CONSECUTIVE_PASSING_CYCLES,
    true
  );
  assert.equal(finalState.promotionReady, true);
});

test('reprovação reinicia sequência e retry do mesmo ciclo é idempotente', () => {
  const first = advanceCommunityRankingV3AcceptanceState({
    previous: null,
    diagnostics: diagnostics(),
    cycleCompletedAt: 1_000,
  });
  const replay = advanceCommunityRankingV3AcceptanceState({
    previous: first,
    diagnostics: diagnostics({ overlapRate: 0 }),
    cycleCompletedAt: 1_000,
  });
  const failed = advanceCommunityRankingV3AcceptanceState({
    previous: replay,
    diagnostics: diagnostics({ overlapRate: 0 }),
    cycleCompletedAt: 2_000,
  });

  assert.deepEqual(replay, first);
  assert.equal(failed.observedCycles, 2);
  assert.equal(failed.consecutivePassingCycles, 0);
  assert.equal(failed.promotionReady, false);
});
