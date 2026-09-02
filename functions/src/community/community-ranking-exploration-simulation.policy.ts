// functions/src/community/community-ranking-exploration-simulation.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RANKING EXPLORATION SIMULATION
// -----------------------------------------------------------------------------
// Simula oportunidades controladas de cold-start sem alterar o ranking servido.
// Comunidade nova não recebe vaga por idade: precisa manter safety absoluto,
// qualidade/frescor mínimos e piso de score do candidato v3.
// -----------------------------------------------------------------------------

export const COMMUNITY_EXPLORATION_TOP_K = 25;
export const COMMUNITY_EXPLORATION_TARGET_NEW_COUNT = 2;
export const COMMUNITY_EXPLORATION_SCAN_DEPTH = 100;
export const COMMUNITY_EXPLORATION_COLD_START_DAYS = 30;
export const COMMUNITY_EXPLORATION_MIN_SCORE = 30;
export const COMMUNITY_EXPLORATION_MIN_QUALITY = 45;
export const COMMUNITY_EXPLORATION_MIN_FRESHNESS = 75;

export interface CommunityRankingExplorationEntry {
  readonly communityId: string;
  readonly discoveryScore: number;
  readonly qualityScore: number;
  readonly freshnessScore: number;
  readonly safetyScore: number;
  readonly communityCreatedAt?: number | null;
}

export interface CommunityRankingExplorationSimulation {
  readonly topK: number;
  readonly scanDepth: number;
  readonly baselineNewCount: number;
  readonly eligiblePoolCount: number;
  readonly selectedExplorationCount: number;
  readonly simulatedNewCount: number;
  readonly baselineNewShare: number;
  readonly simulatedNewShare: number;
  readonly meanSelectedScore: number;
  readonly meanDisplacedScore: number;
  readonly meanScoreCost: number;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

function normalizeScore(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(100, parsed))
    : 0;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function isColdStart(
  entry: CommunityRankingExplorationEntry,
  now: number
): boolean {
  const createdAt = normalizeTimestamp(entry.communityCreatedAt);
  return createdAt !== null
    && createdAt <= now
    && now - createdAt <= COMMUNITY_EXPLORATION_COLD_START_DAYS * DAY_MS;
}

function isExplorationEligible(
  entry: CommunityRankingExplorationEntry,
  now: number
): boolean {
  return isColdStart(entry, now)
    && normalizeScore(entry.safetyScore) === 100
    && normalizeScore(entry.qualityScore) >= COMMUNITY_EXPLORATION_MIN_QUALITY
    && normalizeScore(entry.freshnessScore) >= COMMUNITY_EXPLORATION_MIN_FRESHNESS
    && normalizeScore(entry.discoveryScore) >= COMMUNITY_EXPLORATION_MIN_SCORE;
}

function mean(values: readonly number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

export function buildCommunityRankingExplorationSimulation(input: {
  readonly candidateScan: readonly CommunityRankingExplorationEntry[];
  readonly now: number;
}): CommunityRankingExplorationSimulation {
  const now = Number.isFinite(input.now) && input.now > 0
    ? Math.trunc(input.now)
    : Date.now();
  const scan = input.candidateScan.slice(0, COMMUNITY_EXPLORATION_SCAN_DEPTH);
  const baseline = scan.slice(0, COMMUNITY_EXPLORATION_TOP_K);
  const baselineIds = new Set(baseline.map((entry) => entry.communityId));
  const baselineNewCount = baseline.filter((entry) => isColdStart(entry, now)).length;
  const eligiblePool = scan
    .slice(COMMUNITY_EXPLORATION_TOP_K)
    .filter((entry) =>
      !baselineIds.has(entry.communityId)
      && isExplorationEligible(entry, now)
    );
  const slotsNeeded = Math.max(
    0,
    COMMUNITY_EXPLORATION_TARGET_NEW_COUNT - baselineNewCount
  );
  const selected = eligiblePool.slice(0, slotsNeeded);
  const displaced = selected.length > 0
    ? baseline.slice(Math.max(0, baseline.length - selected.length))
    : [];
  const simulatedNewCount = Math.min(
    COMMUNITY_EXPLORATION_TOP_K,
    baselineNewCount + selected.length
  );
  const selectedScores = selected.map((entry) => normalizeScore(entry.discoveryScore));
  const displacedScores = displaced.map((entry) => normalizeScore(entry.discoveryScore));
  const meanSelectedScore = mean(selectedScores);
  const meanDisplacedScore = mean(displacedScores);

  return {
    topK: COMMUNITY_EXPLORATION_TOP_K,
    scanDepth: scan.length,
    baselineNewCount,
    eligiblePoolCount: eligiblePool.length,
    selectedExplorationCount: selected.length,
    simulatedNewCount,
    baselineNewShare: baseline.length > 0
      ? round((baselineNewCount / baseline.length) * 100)
      : 0,
    simulatedNewShare: baseline.length > 0
      ? round((simulatedNewCount / baseline.length) * 100)
      : 0,
    meanSelectedScore: round(meanSelectedScore),
    meanDisplacedScore: round(meanDisplacedScore),
    meanScoreCost: round(Math.max(0, meanDisplacedScore - meanSelectedScore)),
  };
}
