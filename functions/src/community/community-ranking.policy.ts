// functions/src/community/community-ranking.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY RANKING POLICY
// -----------------------------------------------------------------------------
// Política pura e backend-only para o score orgânico das Comunidades/Locais.
// O cliente nunca escolhe pesos, score ou versão. Segurança e lifecycle atuam
// como gate de elegibilidade; entre itens elegíveis, qualidade, atividade e
// frescor definem a ordenação orgânica. `rankScore` permanece apenas como
// fallback transitório até o rollout e a observação do score v2 serem concluídos.
// -----------------------------------------------------------------------------

export const COMMUNITY_DISCOVERY_SCORE_VERSION = 2;
export const COMMUNITY_DISCOVERY_RANKING_MODE =
  `score_v${COMMUNITY_DISCOVERY_SCORE_VERSION}` as const;

export interface CommunityDiscoveryRankingBreakdown {
  discoveryScore: number;
  qualityScore: number;
  activityScore: number;
  freshnessScore: number;
  safetyScore: number;
  scoreVersion: number;
  scoreUpdatedAt: number;
}

export interface CommunityDiscoveryRankingInput {
  rawCommunity: unknown;
  rawDiscovery?: unknown;
  now: number;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const DISCOVERY_SCORE_WEIGHTS = Object.freeze({
  quality: 0.25,
  activity: 0.45,
  freshness: 0.30,
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

function normalizeScore(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(parsed, 1_000_000_000);
}

function normalizeTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }

  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof source.toMillis === 'function') {
      const time = Number(source.toMillis());
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }

    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const time = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }
  }

  return null;
}

function normalizeText(value: unknown, maxLength: number): string {
  return [...String(value ?? '')]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 || code === 9 || code === 10 || code === 13;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function hasHttpsUrl(value: unknown): boolean {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return false;

  try {
    return new URL(normalized).protocol === 'https:';
  } catch {
    return false;
  }
}

function resolveQualityScore(
  community: Record<string, unknown>,
  discovery: Record<string, unknown>
): number {
  const description = normalizeText(
    discovery['description'] ?? community['description'],
    500
  );
  const descriptionScore = description.length >= 120
    ? 60
    : description.length >= 40
      ? 45
      : description.length > 0
        ? 25
        : 0;
  const avatarScore = hasHttpsUrl(discovery['avatarUrl']) ? 20 : 0;
  const coverScore = hasHttpsUrl(discovery['coverUrl']) ? 20 : 0;

  return normalizeScore(descriptionScore + avatarScore + coverScore);
}

function logarithmicSignal(value: number, saturationAt: number): number {
  if (value <= 0) return 0;
  const capped = Math.min(value, saturationAt);
  return Math.log1p(capped) / Math.log1p(saturationAt);
}

function resolveActivityScore(metrics: Record<string, unknown>): number {
  const memberCount = normalizeCount(metrics['memberCount']);
  const postCount = normalizeCount(metrics['postCount']);
  const mediaCount = normalizeCount(metrics['mediaCount']);
  const memberSignal = logarithmicSignal(memberCount, 250) * 40;
  const postSignal = logarithmicSignal(postCount, 500) * 35;
  const mediaSignal = logarithmicSignal(mediaCount, 100) * 10;
  const postsPerMember = memberCount > 0
    ? Math.min(postCount / memberCount, 5)
    : 0;
  const densitySignal = (postsPerMember / 5) * 15;

  return normalizeScore(
    memberSignal + postSignal + mediaSignal + densitySignal
  );
}

function resolveFreshnessScore(
  community: Record<string, unknown>,
  now: number
): number {
  const lifecycle = asRecord(community['lifecycle']);
  const activityAt =
    normalizeTimestamp(lifecycle['lastMeaningfulActivityAt'])
    ?? normalizeTimestamp(community['updatedAt'])
    ?? normalizeTimestamp(community['createdAt'])
    ?? now;
  const ageDays = Math.max(0, now - Math.min(activityAt, now)) / DAY_MS;

  if (ageDays <= 1) return 100;
  if (ageDays <= 7) return 90;
  if (ageDays <= 30) return 75;
  if (ageDays <= 90) return 50;
  if (ageDays <= 180) return 25;
  return 10;
}

function resolveSafetyScore(community: Record<string, unknown>): number {
  const moderation = asRecord(community['moderation']);
  return community['status'] === 'active' && moderation['state'] === 'active'
    ? 100
    : 0;
}

export function buildCommunityDiscoveryRanking(
  input: Readonly<CommunityDiscoveryRankingInput>
): CommunityDiscoveryRankingBreakdown {
  const community = asRecord(input.rawCommunity);
  const discovery = asRecord(input.rawDiscovery);
  const now = Number.isFinite(input.now) && input.now > 0
    ? Math.trunc(input.now)
    : Date.now();
  const metrics = asRecord(community['metrics']);
  const qualityScore = resolveQualityScore(community, discovery);
  const activityScore = resolveActivityScore(metrics);
  const freshnessScore = resolveFreshnessScore(community, now);
  const safetyScore = resolveSafetyScore(community);
  const discoveryScore = safetyScore === 100
    ? normalizeScore(
      qualityScore * DISCOVERY_SCORE_WEIGHTS.quality
        + activityScore * DISCOVERY_SCORE_WEIGHTS.activity
        + freshnessScore * DISCOVERY_SCORE_WEIGHTS.freshness
    )
    : 0;

  return {
    discoveryScore,
    qualityScore,
    activityScore,
    freshnessScore,
    safetyScore,
    scoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
    scoreUpdatedAt: now,
  };
}
