export const MEDIA_RANKING_VERSION = 2;
export const MEDIA_FRESHNESS_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

const MEDIA_VIEW_VOLUME_REFERENCE = 10_000;
const MEDIA_VIEW_UNIQUENESS_CONFIDENCE_VIEWS = 20;
const MEDIA_RETENTION_CONFIDENCE_VIEWS = 10;

export interface MediaScoreBreakdown {
  rankingScore: number;
  qualityScore: number;
  engagementScore: number;
  viewScore: number;
  retentionScore: number;
  freshnessScore: number;
  safetyScore: number;
}

export interface MediaEngagementInput {
  reactionsCount: number;
  commentsCount: number;
  ratingsCount?: number;
  ratingAverage?: number;
  viewsCount?: number;
  uniqueViewersCount?: number;
  qualifiedViewsCount?: number;
  totalQualifiedPlaybackMs?: number;
  totalQualifiedDurationMs?: number;
  publishedAt?: number;
  now?: number;
  currentBreakdown?: Partial<MediaScoreBreakdown> | null;
}

export interface MediaEngagementResult {
  score: number;
  engagementScore: number;
  viewScore: number;
  retentionScore: number;
  freshnessScore: number;
  scoreBreakdown: MediaScoreBreakdown;
}

export function normalizeMediaCount(value: unknown): number {
  const count = Number(value ?? 0);

  if (!Number.isFinite(count) || count < 0) {
    return 0;
  }

  return Math.floor(count);
}

export function normalizeMediaTotal(value: unknown): number {
  const total = Number(value ?? 0);

  if (!Number.isFinite(total) || total < 0) {
    return 0;
  }

  return Math.floor(total);
}

export function normalizeMediaScore(value: unknown): number {
  const score = Number(value ?? 0);

  if (!Number.isFinite(score)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

export function normalizeMediaRatingAverage(value: unknown): number {
  const rating = Number(value ?? 0);

  if (!Number.isFinite(rating)) {
    return 0;
  }

  return Math.max(0, Math.min(5, rating));
}

export function normalizeMediaTimestamp(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  const timestamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
    seconds?: number;
  } | null | undefined;

  if (typeof timestamp?.toMillis === 'function') {
    try {
      return normalizeMediaTimestamp(timestamp.toMillis());
    } catch {
      return 0;
    }
  }

  if (typeof timestamp?.toDate === 'function') {
    try {
      return normalizeMediaTimestamp(timestamp.toDate().getTime());
    } catch {
      return 0;
    }
  }

  if (typeof timestamp?.seconds === 'number') {
    return normalizeMediaTimestamp(timestamp.seconds * 1000);
  }

  return 0;
}

export function calculateMediaViewScore(input: {
  viewsCount: unknown;
  uniqueViewersCount: unknown;
}): number {
  const viewsCount = normalizeMediaCount(input.viewsCount);
  const uniqueViewersCount = Math.min(
    viewsCount,
    normalizeMediaCount(input.uniqueViewersCount)
  );

  if (viewsCount === 0) {
    return 0;
  }

  const volumeScore = Math.min(
    100,
    Math.log1p(viewsCount) / Math.log1p(MEDIA_VIEW_VOLUME_REFERENCE) * 100
  );
  const uniqueRatio = uniqueViewersCount / viewsCount;
  const uniquenessConfidence =
    1 - Math.exp(-viewsCount / MEDIA_VIEW_UNIQUENESS_CONFIDENCE_VIEWS);
  const uniqueQualityScore = uniqueRatio * uniquenessConfidence * 100;

  return normalizeMediaScore(
    volumeScore * 0.65 + uniqueQualityScore * 0.35
  );
}

export function calculateMediaRetentionScore(input: {
  qualifiedViewsCount: unknown;
  totalQualifiedPlaybackMs: unknown;
  totalQualifiedDurationMs: unknown;
}): number {
  const qualifiedViewsCount = normalizeMediaCount(input.qualifiedViewsCount);
  const totalQualifiedPlaybackMs = normalizeMediaTotal(
    input.totalQualifiedPlaybackMs
  );
  const totalQualifiedDurationMs = normalizeMediaTotal(
    input.totalQualifiedDurationMs
  );

  if (
    qualifiedViewsCount === 0 ||
    totalQualifiedDurationMs === 0
  ) {
    return 0;
  }

  const retentionRatio = Math.min(
    1,
    totalQualifiedPlaybackMs / totalQualifiedDurationMs
  );
  const confidence =
    1 - Math.exp(-qualifiedViewsCount / MEDIA_RETENTION_CONFIDENCE_VIEWS);

  return normalizeMediaScore(retentionRatio * confidence * 100);
}

export function calculateMediaFreshnessScore(input: {
  publishedAt: unknown;
  now?: unknown;
}): number {
  const publishedAt = normalizeMediaTimestamp(input.publishedAt);
  const normalizedNow = normalizeMediaTimestamp(input.now) || Date.now();

  if (!publishedAt) {
    return 0;
  }

  const ageMs = Math.max(0, normalizedNow - publishedAt);
  const freshness = 100 * Math.pow(
    0.5,
    ageMs / MEDIA_FRESHNESS_HALF_LIFE_MS
  );

  return normalizeMediaScore(freshness);
}

export function buildMediaEngagementScore(
  input: MediaEngagementInput
): MediaEngagementResult {
  const reactionsCount = normalizeMediaCount(input.reactionsCount);
  const commentsCount = normalizeMediaCount(input.commentsCount);
  const ratingsCount = normalizeMediaCount(input.ratingsCount);
  const ratingAverage = normalizeMediaRatingAverage(input.ratingAverage);
  const ratingWeight = ratingsCount * (ratingAverage / 5) * 3;
  const weightedEngagement =
    reactionsCount * 2 + commentsCount * 4 + ratingWeight;
  const engagementScore = normalizeMediaScore(
    Math.round(Math.log1p(weightedEngagement) * 18)
  );
  const currentBreakdown = input.currentBreakdown ?? {};
  const hasViewMetrics =
    input.viewsCount !== undefined || input.uniqueViewersCount !== undefined;
  const hasRetentionMetrics =
    input.qualifiedViewsCount !== undefined ||
    input.totalQualifiedPlaybackMs !== undefined ||
    input.totalQualifiedDurationMs !== undefined;
  const hasFreshnessMetrics = input.publishedAt !== undefined;
  const viewScore = hasViewMetrics
    ? calculateMediaViewScore({
      viewsCount: input.viewsCount,
      uniqueViewersCount: input.uniqueViewersCount,
    })
    : normalizeMediaScore(currentBreakdown.viewScore);
  const retentionScore = hasRetentionMetrics
    ? calculateMediaRetentionScore({
      qualifiedViewsCount: input.qualifiedViewsCount,
      totalQualifiedPlaybackMs: input.totalQualifiedPlaybackMs,
      totalQualifiedDurationMs: input.totalQualifiedDurationMs,
    })
    : normalizeMediaScore(currentBreakdown.retentionScore);
  const freshnessScore = hasFreshnessMetrics
    ? calculateMediaFreshnessScore({
      publishedAt: input.publishedAt,
      now: input.now,
    })
    : normalizeMediaScore(currentBreakdown.freshnessScore);
  const scoreBreakdown: MediaScoreBreakdown = {
    qualityScore: normalizeMediaScore(currentBreakdown.qualityScore ?? 0),
    safetyScore: normalizeMediaScore(currentBreakdown.safetyScore ?? 100),
    engagementScore,
    viewScore,
    retentionScore,
    freshnessScore,
    rankingScore: 0,
  };
  const evidenceConfidence = Math.max(
    scoreBreakdown.qualityScore,
    scoreBreakdown.engagementScore,
    scoreBreakdown.viewScore,
    scoreBreakdown.retentionScore
  ) / 100;

  scoreBreakdown.rankingScore = normalizeMediaScore(
    Math.round(
      scoreBreakdown.qualityScore * 0.15 +
      scoreBreakdown.engagementScore * 0.25 +
      scoreBreakdown.viewScore * 0.20 +
      scoreBreakdown.retentionScore * 0.20 +
      scoreBreakdown.freshnessScore * 0.10 +
      scoreBreakdown.safetyScore * 0.10 * evidenceConfidence
    )
  );

  return {
    score: scoreBreakdown.rankingScore,
    engagementScore,
    viewScore,
    retentionScore,
    freshnessScore,
    scoreBreakdown,
  };
}
