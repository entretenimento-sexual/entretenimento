// functions/src/community/community-ranking-exposure-diagnostics.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY RANKING EXPOSURE DIAGNOSTICS
// -----------------------------------------------------------------------------
// Resume somente contadores agregados de exposição qualificada do ranking que
// foi efetivamente servido. Não atribui exposição ao candidato shadow-only e
// não recebe identidade, sessão ou histórico de navegação.
// -----------------------------------------------------------------------------

export interface CommunityRankingExposureEntry {
  readonly exposureCount: number;
  readonly communityCreatedAt?: number | null;
}

export interface CommunityRankingExposureDiagnostics {
  readonly sampleCount: number;
  readonly exposedCommunityCount: number;
  readonly zeroExposureCommunityCount: number;
  readonly totalQualifiedExposures: number;
  readonly topRankedFiveExposureShare: number;
  readonly exposureHhi: number;
  readonly knownAgeExposureShare: number;
  readonly newCommunityExposureShare: number;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const COLD_START_WINDOW_DAYS = 30;

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function round(value: number, precision = 2): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

export function buildCommunityRankingExposureDiagnostics(input: {
  readonly entries: readonly CommunityRankingExposureEntry[];
  readonly now: number;
}): CommunityRankingExposureDiagnostics {
  const now = Number.isFinite(input.now) && input.now > 0
    ? Math.trunc(input.now)
    : Date.now();
  const counts = input.entries.map((entry) => normalizeCount(entry.exposureCount));
  const totalQualifiedExposures = counts.reduce((sum, count) => sum + count, 0);
  const exposedCommunityCount = counts.filter((count) => count > 0).length;
  const topRankedFiveExposures = counts
    .slice(0, 5)
    .reduce((sum, count) => sum + count, 0);
  let hhi = 0;
  let knownAgeExposures = 0;
  let newCommunityExposures = 0;

  input.entries.forEach((entry, index) => {
    const count = counts[index] ?? 0;
    if (totalQualifiedExposures > 0) {
      const share = count / totalQualifiedExposures;
      hhi += share * share;
    }

    const createdAt = normalizeTimestamp(entry.communityCreatedAt);
    if (createdAt === null || createdAt > now) return;

    knownAgeExposures += count;
    if (now - createdAt <= COLD_START_WINDOW_DAYS * DAY_MS) {
      newCommunityExposures += count;
    }
  });

  return {
    sampleCount: input.entries.length,
    exposedCommunityCount,
    zeroExposureCommunityCount: input.entries.length - exposedCommunityCount,
    totalQualifiedExposures,
    topRankedFiveExposureShare: totalQualifiedExposures > 0
      ? round((topRankedFiveExposures / totalQualifiedExposures) * 100)
      : 0,
    exposureHhi: totalQualifiedExposures > 0 ? round(hhi * 10_000) : 0,
    knownAgeExposureShare: totalQualifiedExposures > 0
      ? round((knownAgeExposures / totalQualifiedExposures) * 100)
      : 0,
    newCommunityExposureShare: knownAgeExposures > 0
      ? round((newCommunityExposures / knownAgeExposures) * 100)
      : 0,
  };
}
