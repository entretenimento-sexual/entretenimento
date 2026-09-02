// functions/src/community/community-ranking-shadow-diagnostics.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RANKING SHADOW DIAGNOSTICS
// -----------------------------------------------------------------------------
// Compara, de forma agregada, a ordenação oficial v2 com o candidato v3.
// Não recebe nomes, perfis, memberships, impressões individuais ou histórico
// de navegação. O objetivo é medir estabilidade do ranking antes de qualquer
// cutover do candidato shadow-only.
// -----------------------------------------------------------------------------

import {
  buildCommunityRankingColdStartDiagnostics,
  type CommunityRankingColdStartDiagnostics,
} from './community-ranking-cold-start-diagnostics.policy';

export interface CommunityRankingShadowEntry {
  communityId: string;
  score: number;
  communityCreatedAt?: number | null;
}

export interface CommunityRankingShadowDiagnostics {
  topK: number;
  comparisonDepth: number;
  officialTopCount: number;
  candidateTopCount: number;
  overlapCount: number;
  overlapRate: number;
  rankAgreement: number;
  meanAbsoluteRankShift: number;
  maxAbsoluteRankShift: number;
  candidateEntrants: number;
  candidateExits: number;
  meanCandidateScoreDelta: number;
  coldStart: CommunityRankingColdStartDiagnostics;
}

function normalizeTopK(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), 100)
    : 25;
}

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

function normalizeEntries(
  entries: readonly CommunityRankingShadowEntry[],
  topK: number
): CommunityRankingShadowEntry[] {
  const seen = new Set<string>();
  const normalized: CommunityRankingShadowEntry[] = [];

  for (const entry of entries) {
    const communityId = String(entry.communityId ?? '').trim();
    if (!communityId || seen.has(communityId)) continue;

    seen.add(communityId);
    normalized.push({
      communityId,
      score: normalizeScore(entry.score),
      communityCreatedAt: normalizeTimestamp(entry.communityCreatedAt),
    });

    if (normalized.length >= topK) break;
  }

  return normalized;
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function buildCommunityRankingShadowDiagnostics(input: {
  officialTop: readonly CommunityRankingShadowEntry[];
  candidateTop: readonly CommunityRankingShadowEntry[];
  topK?: number;
  now?: number;
}): CommunityRankingShadowDiagnostics {
  const topK = normalizeTopK(input.topK);
  const parsedNow = Number(input.now);
  const now = Number.isFinite(parsedNow) && parsedNow > 0
    ? Math.trunc(parsedNow)
    : Date.now();
  const officialTop = normalizeEntries(input.officialTop, topK);
  const candidateTop = normalizeEntries(input.candidateTop, topK);
  const officialPositions = new Map(
    officialTop.map((entry, index) => [entry.communityId, index + 1])
  );
  const candidatePositions = new Map(
    candidateTop.map((entry, index) => [entry.communityId, index + 1])
  );
  const officialScores = new Map(
    officialTop.map((entry) => [entry.communityId, entry.score])
  );

  const rankShifts: number[] = [];
  const scoreDeltas: number[] = [];
  let candidateEntrants = 0;

  for (const entry of candidateTop) {
    const officialPosition = officialPositions.get(entry.communityId);
    if (officialPosition === undefined) {
      candidateEntrants += 1;
      continue;
    }

    const candidatePosition = candidatePositions.get(entry.communityId) ?? 0;
    rankShifts.push(Math.abs(candidatePosition - officialPosition));
    scoreDeltas.push(entry.score - (officialScores.get(entry.communityId) ?? 0));
  }

  let candidateExits = 0;
  for (const entry of officialTop) {
    if (!candidatePositions.has(entry.communityId)) candidateExits += 1;
  }

  const overlapCount = rankShifts.length;
  const comparisonDepth = Math.min(
    topK,
    officialTop.length,
    candidateTop.length
  );
  const overlapRate = comparisonDepth > 0
    ? overlapCount / comparisonDepth
    : 0;
  const meanAbsoluteRankShift = overlapCount > 0
    ? rankShifts.reduce((sum, value) => sum + value, 0) / overlapCount
    : 0;
  const maxAbsoluteRankShift = overlapCount > 0
    ? Math.max(...rankShifts)
    : 0;
  const maximumMeaningfulShift = Math.max(comparisonDepth - 1, 1);
  const rankAgreement = comparisonDepth > 0
    ? Math.max(0, 1 - meanAbsoluteRankShift / maximumMeaningfulShift)
    : 0;
  const meanCandidateScoreDelta = scoreDeltas.length > 0
    ? scoreDeltas.reduce((sum, value) => sum + value, 0) / scoreDeltas.length
    : 0;

  return {
    topK,
    comparisonDepth,
    officialTopCount: officialTop.length,
    candidateTopCount: candidateTop.length,
    overlapCount,
    overlapRate: round(overlapRate * 100),
    rankAgreement: round(rankAgreement * 100),
    meanAbsoluteRankShift: round(meanAbsoluteRankShift),
    maxAbsoluteRankShift,
    candidateEntrants,
    candidateExits,
    meanCandidateScoreDelta: round(meanCandidateScoreDelta),
    coldStart: buildCommunityRankingColdStartDiagnostics({
      officialTop,
      candidateTop,
      now,
    }),
  };
}
