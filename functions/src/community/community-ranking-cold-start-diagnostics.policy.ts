// functions/src/community/community-ranking-cold-start-diagnostics.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RANKING COLD-START DIAGNOSTICS
// -----------------------------------------------------------------------------
// Mede apenas a representação agregada de comunidades novas nas amostras top-K.
// Não recebe identidade de usuário, membership, impressão ou histórico de
// navegação. Ausência de idade canônica é explicitada por cobertura, sem usar
// timestamps de atualização/ranking como substitutos.
// -----------------------------------------------------------------------------

export const COMMUNITY_RANKING_COLD_START_WINDOW_DAYS = 30;

export interface CommunityRankingColdStartEntry {
  communityCreatedAt?: number | null;
}

export interface CommunityRankingColdStartDiagnostics {
  windowDays: number;
  officialKnownAgeCount: number;
  candidateKnownAgeCount: number;
  officialAgeCoverageRate: number;
  candidateAgeCoverageRate: number;
  officialNewCount: number;
  candidateNewCount: number;
  officialNewShare: number;
  candidateNewShare: number;
  newShareDelta: number;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function summarizeSample(input: {
  entries: readonly CommunityRankingColdStartEntry[];
  now: number;
  windowMs: number;
}): {
  knownAgeCount: number;
  newCount: number;
  ageCoverageRate: number;
  newShare: number;
} {
  let knownAgeCount = 0;
  let newCount = 0;

  for (const entry of input.entries) {
    const createdAt = normalizeTimestamp(entry.communityCreatedAt);
    if (createdAt === null || createdAt > input.now) continue;

    knownAgeCount += 1;
    if (input.now - createdAt <= input.windowMs) newCount += 1;
  }

  return {
    knownAgeCount,
    newCount,
    ageCoverageRate: input.entries.length > 0
      ? round((knownAgeCount / input.entries.length) * 100)
      : 0,
    newShare: knownAgeCount > 0
      ? round((newCount / knownAgeCount) * 100)
      : 0,
  };
}

export function buildCommunityRankingColdStartDiagnostics(input: {
  officialTop: readonly CommunityRankingColdStartEntry[];
  candidateTop: readonly CommunityRankingColdStartEntry[];
  now: number;
}): CommunityRankingColdStartDiagnostics {
  const now = Number.isFinite(input.now) && input.now > 0
    ? Math.trunc(input.now)
    : Date.now();
  const windowDays = COMMUNITY_RANKING_COLD_START_WINDOW_DAYS;
  const windowMs = windowDays * 24 * 60 * 60 * 1_000;
  const official = summarizeSample({
    entries: input.officialTop,
    now,
    windowMs,
  });
  const candidate = summarizeSample({
    entries: input.candidateTop,
    now,
    windowMs,
  });

  return {
    windowDays,
    officialKnownAgeCount: official.knownAgeCount,
    candidateKnownAgeCount: candidate.knownAgeCount,
    officialAgeCoverageRate: official.ageCoverageRate,
    candidateAgeCoverageRate: candidate.ageCoverageRate,
    officialNewCount: official.newCount,
    candidateNewCount: candidate.newCount,
    officialNewShare: official.newShare,
    candidateNewShare: candidate.newShare,
    newShareDelta: round(candidate.newShare - official.newShare),
  };
}
