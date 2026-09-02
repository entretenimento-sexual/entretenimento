// functions/src/community/community-ranking-candidate-v3.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY RANKING CANDIDATE V3
// -----------------------------------------------------------------------------
// Candidato shadow-only. O score v2 continua sendo o discoveryScore autoritativo.
// Esta policy mede atividade por deltas entre métricas acumuladas e mantém apenas
// momento agregado com decaimento temporal; não cria histórico por usuário.
// -----------------------------------------------------------------------------

import { buildCommunityDiscoveryRanking } from './community-ranking.policy';

export const COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION = 3;

export interface CommunityRankingActivityBaselineV3 {
  memberCount: number;
  postCount: number;
  mediaCount: number;
  interactionCount: number;
  measuredAt: number;
}

export interface CommunityRankingActivityMomentumV3 {
  shortTerm: number;
  mediumTerm: number;
  churnShortTerm: number;
  churnMediumTerm: number;
}

export interface CommunityRankingActivityDeltaV3 {
  memberGrowth: number;
  memberLoss: number;
  postGrowth: number;
  mediaGrowth: number;
  interactionGrowth: number;
}

export interface CommunityDiscoveryRankingCandidateV3 {
  discoveryScore: number;
  qualityScore: number;
  activityScore: number;
  freshnessScore: number;
  safetyScore: number;
  scoreVersion: 3;
  scoreUpdatedAt: number;
  activityBaseline: CommunityRankingActivityBaselineV3;
  activityMomentum: CommunityRankingActivityMomentumV3;
  activityDelta: CommunityRankingActivityDeltaV3;
}

export interface CommunityDiscoveryRankingCandidateV3Input {
  rawCommunity: unknown;
  rawDiscovery?: unknown;
  now: number;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const SHORT_HALF_LIFE_DAYS = 7;
const MEDIUM_HALF_LIFE_DAYS = 30;
const MAX_MOMENTUM = 10_000;
const V3_SCORE_WEIGHTS = Object.freeze({
  quality: 0.15,
  activity: 0.55,
  freshness: 0.30,
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 1_000_000_000);
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeMomentum(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(parsed, MAX_MOMENTUM);
}

function roundMomentum(value: number): number {
  return Math.round(Math.max(0, Math.min(value, MAX_MOMENTUM)) * 10_000) / 10_000;
}

function logarithmicSignal(value: number, saturationAt: number): number {
  if (value <= 0) return 0;
  const capped = Math.min(value, saturationAt);
  return Math.log1p(capped) / Math.log1p(saturationAt);
}

function decayForHalfLife(elapsedDays: number, halfLifeDays: number): number {
  if (elapsedDays <= 0) return 1;
  return Math.pow(0.5, elapsedDays / halfLifeDays);
}

function currentBaseline(
  rawCommunity: unknown,
  measuredAt: number
): CommunityRankingActivityBaselineV3 {
  const community = asRecord(rawCommunity);
  const metrics = asRecord(community['metrics']);

  return {
    memberCount: normalizeCount(metrics['memberCount']),
    postCount: normalizeCount(metrics['postCount']),
    mediaCount: normalizeCount(metrics['mediaCount']),
    interactionCount: normalizeCount(metrics['interactionCount']),
    measuredAt,
  };
}

function previousCandidate(rawDiscovery: unknown): Record<string, unknown> | null {
  const discovery = asRecord(rawDiscovery);
  const candidate = asRecord(discovery['rankingCandidate']);

  return Number(candidate['scoreVersion']) === COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION
    ? candidate
    : null;
}

function previousBaseline(
  candidate: Record<string, unknown> | null
): CommunityRankingActivityBaselineV3 | null {
  if (!candidate) return null;

  const baseline = asRecord(candidate['activityBaseline']);
  const measuredAt = normalizeTimestamp(baseline['measuredAt']);
  if (!measuredAt) return null;

  return {
    memberCount: normalizeCount(baseline['memberCount']),
    postCount: normalizeCount(baseline['postCount']),
    mediaCount: normalizeCount(baseline['mediaCount']),
    interactionCount: normalizeCount(baseline['interactionCount']),
    measuredAt,
  };
}

function previousMomentum(
  candidate: Record<string, unknown> | null
): CommunityRankingActivityMomentumV3 {
  const momentum = asRecord(candidate?.['activityMomentum']);

  return {
    shortTerm: normalizeMomentum(momentum['shortTerm']),
    mediumTerm: normalizeMomentum(momentum['mediumTerm']),
    churnShortTerm: normalizeMomentum(momentum['churnShortTerm']),
    churnMediumTerm: normalizeMomentum(momentum['churnMediumTerm']),
  };
}

function resolveActivityState(
  rawCommunity: unknown,
  rawDiscovery: unknown,
  now: number
): {
  baseline: CommunityRankingActivityBaselineV3;
  momentum: CommunityRankingActivityMomentumV3;
  delta: CommunityRankingActivityDeltaV3;
} {
  const baseline = currentBaseline(rawCommunity, now);
  const candidate = previousCandidate(rawDiscovery);
  const previous = previousBaseline(candidate);

  if (!previous) {
    return {
      baseline,
      momentum: {
        shortTerm: 0,
        mediumTerm: 0,
        churnShortTerm: 0,
        churnMediumTerm: 0,
      },
      delta: {
        memberGrowth: 0,
        memberLoss: 0,
        postGrowth: 0,
        mediaGrowth: 0,
        interactionGrowth: 0,
      },
    };
  }

  const priorMomentum = previousMomentum(candidate);
  const elapsedDays = Math.max(0, now - Math.min(previous.measuredAt, now)) / DAY_MS;
  const shortDecay = decayForHalfLife(elapsedDays, SHORT_HALF_LIFE_DAYS);
  const mediumDecay = decayForHalfLife(elapsedDays, MEDIUM_HALF_LIFE_DAYS);
  const memberGrowth = Math.max(baseline.memberCount - previous.memberCount, 0);
  const memberLoss = Math.max(previous.memberCount - baseline.memberCount, 0);
  const postGrowth = Math.max(baseline.postCount - previous.postCount, 0);
  const mediaGrowth = Math.max(baseline.mediaCount - previous.mediaCount, 0);
  const interactionGrowth = Math.max(
    baseline.interactionCount - previous.interactionCount,
    0
  );

  // Publicação é o sinal principal. Interação entra com peso menor e saturação;
  // crescimento de membros representa saúde de rede, não popularidade histórica.
  const engagementUnits =
    postGrowth * 4
    + mediaGrowth * 2
    + memberGrowth * 2
    + interactionGrowth;
  const churnUnits = memberLoss * 3;

  return {
    baseline,
    momentum: {
      shortTerm: roundMomentum(
        priorMomentum.shortTerm * shortDecay + engagementUnits
      ),
      mediumTerm: roundMomentum(
        priorMomentum.mediumTerm * mediumDecay + engagementUnits
      ),
      churnShortTerm: roundMomentum(
        priorMomentum.churnShortTerm * shortDecay + churnUnits
      ),
      churnMediumTerm: roundMomentum(
        priorMomentum.churnMediumTerm * mediumDecay + churnUnits
      ),
    },
    delta: {
      memberGrowth,
      memberLoss,
      postGrowth,
      mediaGrowth,
      interactionGrowth,
    },
  };
}

function resolveActivityScore(
  baseline: Readonly<CommunityRankingActivityBaselineV3>,
  momentum: Readonly<CommunityRankingActivityMomentumV3>
): number {
  const shortSignal = logarithmicSignal(momentum.shortTerm, 80) * 60;
  const mediumSignal = logarithmicSignal(momentum.mediumTerm, 300) * 25;
  const memberHealthSignal = logarithmicSignal(baseline.memberCount, 250) * 15;
  const churnPenalty =
    logarithmicSignal(momentum.churnShortTerm, 40) * 20
    + logarithmicSignal(momentum.churnMediumTerm, 150) * 10;

  return normalizeScore(
    shortSignal + mediumSignal + memberHealthSignal - churnPenalty
  );
}

export function buildCommunityDiscoveryRankingCandidateV3(
  input: Readonly<CommunityDiscoveryRankingCandidateV3Input>
): CommunityDiscoveryRankingCandidateV3 {
  const now = Number.isFinite(input.now) && input.now > 0
    ? Math.trunc(input.now)
    : Date.now();
  const v2 = buildCommunityDiscoveryRanking({
    rawCommunity: input.rawCommunity,
    rawDiscovery: input.rawDiscovery,
    now,
  });
  const activityState = resolveActivityState(
    input.rawCommunity,
    input.rawDiscovery,
    now
  );
  const activityScore = resolveActivityScore(
    activityState.baseline,
    activityState.momentum
  );
  const discoveryScore = v2.safetyScore === 100
    ? normalizeScore(
      v2.qualityScore * V3_SCORE_WEIGHTS.quality
      + activityScore * V3_SCORE_WEIGHTS.activity
      + v2.freshnessScore * V3_SCORE_WEIGHTS.freshness
    )
    : 0;

  return {
    discoveryScore,
    qualityScore: v2.qualityScore,
    activityScore,
    freshnessScore: v2.freshnessScore,
    safetyScore: v2.safetyScore,
    scoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
    scoreUpdatedAt: now,
    activityBaseline: activityState.baseline,
    activityMomentum: activityState.momentum,
    activityDelta: activityState.delta,
  };
}
