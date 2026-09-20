// functions/src/community/community-ranking-v3-acceptance.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RANKING V3 ACCEPTANCE POLICY
// -----------------------------------------------------------------------------
// Gate mensurável e backend-only para retirar o candidato v3 do shadow.
//
// Não usa identidade, histórico individual, receita, assinatura ou sinais
// comerciais. A promoção exige uma janela mínima de ciclos completos e
// estabilidade consecutiva; um snapshot isolado nunca autoriza o cutover.
// -----------------------------------------------------------------------------

import {
  COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
  COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
} from './community-ranking-candidate-v3.policy';
import type {
  CommunityRankingShadowDiagnostics,
} from './community-ranking-shadow-diagnostics.policy';

export const COMMUNITY_RANKING_V3_ACCEPTANCE_POLICY_VERSION = 1;
export const COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES = 7;
export const COMMUNITY_RANKING_V3_MIN_CONSECUTIVE_PASSING_CYCLES = 3;

export const COMMUNITY_RANKING_V3_ACCEPTANCE_THRESHOLDS = Object.freeze({
  minimumComparisonDepth: 20,
  minimumOverlapRate: 60,
  minimumRankAgreement: 75,
  maximumMeanAbsoluteRankShift: 6,
  maximumAbsoluteRankShift: 18,
  minimumCandidateAgeCoverageRate: 90,
  maximumAbsoluteNewShareDelta: 20,
});

export type CommunityRankingV3AcceptanceCriterion =
  | 'comparison_depth'
  | 'overlap_rate'
  | 'rank_agreement'
  | 'mean_absolute_rank_shift'
  | 'max_absolute_rank_shift'
  | 'candidate_age_coverage'
  | 'new_share_delta';

export interface CommunityRankingV3AcceptanceEvaluation {
  readonly accepted: boolean;
  readonly failedCriteria: readonly CommunityRankingV3AcceptanceCriterion[];
}

export interface CommunityRankingV3AcceptanceState {
  readonly policyVersion: typeof COMMUNITY_RANKING_V3_ACCEPTANCE_POLICY_VERSION;
  readonly candidateScoreVersion: typeof COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION;
  readonly candidateActivityMomentumModelVersion:
    typeof COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION;
  readonly observedCycles: number;
  readonly passingCycles: number;
  readonly consecutivePassingCycles: number;
  readonly promotionReady: boolean;
  readonly firstObservedCycleCompletedAt: number;
  readonly lastObservedCycleCompletedAt: number;
  readonly lastObservedDay: string;
  readonly lastEvaluation: CommunityRankingV3AcceptanceEvaluation;
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function observationDay(value: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function evaluateCommunityRankingV3Acceptance(
  diagnostics: Readonly<CommunityRankingShadowDiagnostics>
): CommunityRankingV3AcceptanceEvaluation {
  const thresholds = COMMUNITY_RANKING_V3_ACCEPTANCE_THRESHOLDS;
  const failedCriteria: CommunityRankingV3AcceptanceCriterion[] = [];

  if (diagnostics.comparisonDepth < thresholds.minimumComparisonDepth) {
    failedCriteria.push('comparison_depth');
  }
  if (diagnostics.overlapRate < thresholds.minimumOverlapRate) {
    failedCriteria.push('overlap_rate');
  }
  if (diagnostics.rankAgreement < thresholds.minimumRankAgreement) {
    failedCriteria.push('rank_agreement');
  }
  if (
    diagnostics.meanAbsoluteRankShift
      > thresholds.maximumMeanAbsoluteRankShift
  ) {
    failedCriteria.push('mean_absolute_rank_shift');
  }
  if (diagnostics.maxAbsoluteRankShift > thresholds.maximumAbsoluteRankShift) {
    failedCriteria.push('max_absolute_rank_shift');
  }
  if (
    diagnostics.coldStart.candidateAgeCoverageRate
      < thresholds.minimumCandidateAgeCoverageRate
  ) {
    failedCriteria.push('candidate_age_coverage');
  }
  if (
    Math.abs(diagnostics.coldStart.newShareDelta)
      > thresholds.maximumAbsoluteNewShareDelta
  ) {
    failedCriteria.push('new_share_delta');
  }

  return {
    accepted: failedCriteria.length === 0,
    failedCriteria,
  };
}

export function advanceCommunityRankingV3AcceptanceState(input: {
  readonly previous: unknown;
  readonly diagnostics: Readonly<CommunityRankingShadowDiagnostics>;
  readonly cycleCompletedAt: number;
}): CommunityRankingV3AcceptanceState {
  const previous = asRecord(input.previous);
  const cycleCompletedAt = normalizeTimestamp(input.cycleCompletedAt)
    ?? Date.now();
  const samePolicy =
    Number(previous['policyVersion'])
      === COMMUNITY_RANKING_V3_ACCEPTANCE_POLICY_VERSION
    && Number(previous['candidateScoreVersion'])
      === COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION
    && Number(previous['candidateActivityMomentumModelVersion'])
      === COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION;
  const previousCycleCompletedAt = samePolicy
    ? normalizeTimestamp(previous['lastObservedCycleCompletedAt'])
    : null;
  const previousFirstCycleCompletedAt = samePolicy
    ? normalizeTimestamp(previous['firstObservedCycleCompletedAt'])
    : null;
  const currentObservationDay = observationDay(cycleCompletedAt);
  const previousObservedDay = samePolicy
    ? String(previous['lastObservedDay'] ?? '').trim()
    : '';
  const previousEvaluation = asRecord(previous['lastEvaluation']);
  let previousState: CommunityRankingV3AcceptanceState | null = null;

  if (samePolicy && previousCycleCompletedAt) {
    const failedCriteria = Array.isArray(previousEvaluation['failedCriteria'])
      ? previousEvaluation['failedCriteria']
        .map((value) => String(value ?? '').trim())
        .filter(Boolean) as CommunityRankingV3AcceptanceCriterion[]
      : [];

    previousState = {
      policyVersion: COMMUNITY_RANKING_V3_ACCEPTANCE_POLICY_VERSION,
      candidateScoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      candidateActivityMomentumModelVersion:
        COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
      observedCycles: normalizeCount(previous['observedCycles']),
      passingCycles: normalizeCount(previous['passingCycles']),
      consecutivePassingCycles: normalizeCount(
        previous['consecutivePassingCycles']
      ),
      promotionReady: previous['promotionReady'] === true,
      firstObservedCycleCompletedAt:
        previousFirstCycleCompletedAt ?? previousCycleCompletedAt,
      lastObservedCycleCompletedAt: previousCycleCompletedAt,
      lastObservedDay:
        previousObservedDay || observationDay(previousCycleCompletedAt),
      lastEvaluation: {
        accepted: previousEvaluation['accepted'] === true,
        failedCriteria,
      },
    };
  }

  // Retry, rerun ou execução manual no mesmo dia não acelera a janela.
  if (
    previousState
    && previousState.lastObservedDay === currentObservationDay
  ) {
    return previousState;
  }

  const evaluation = evaluateCommunityRankingV3Acceptance(input.diagnostics);
  const observedCycles = (previousState?.observedCycles ?? 0) + 1;
  const passingCycles =
    (previousState?.passingCycles ?? 0) + (evaluation.accepted ? 1 : 0);
  const consecutivePassingCycles = evaluation.accepted
    ? (previousState?.consecutivePassingCycles ?? 0) + 1
    : 0;
  const promotionReady =
    evaluation.accepted
    && observedCycles >= COMMUNITY_RANKING_V3_MIN_OBSERVED_CYCLES
    && consecutivePassingCycles
      >= COMMUNITY_RANKING_V3_MIN_CONSECUTIVE_PASSING_CYCLES;

  return {
    policyVersion: COMMUNITY_RANKING_V3_ACCEPTANCE_POLICY_VERSION,
    candidateScoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
    candidateActivityMomentumModelVersion:
      COMMUNITY_ACTIVITY_MOMENTUM_MODEL_VERSION,
    observedCycles,
    passingCycles,
    consecutivePassingCycles,
    promotionReady,
    firstObservedCycleCompletedAt:
      previousState?.firstObservedCycleCompletedAt ?? cycleCompletedAt,
    lastObservedCycleCompletedAt: cycleCompletedAt,
    lastObservedDay: currentObservationDay,
    lastEvaluation: evaluation,
  };
}
