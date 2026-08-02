import {
  MEDIA_RANKING_VERSION,
  buildMediaEngagementScore,
  normalizeMediaCount,
  normalizeMediaScore,
  normalizeMediaTimestamp,
  normalizeMediaTotal,
  type MediaScoreBreakdown,
} from './media-engagement-score';

export const PHOTO_RANKING_QUALIFIED_VISIBLE_TARGET_MS = 8_000;
export const PHOTO_RANKING_MAX_VISIBLE_SAMPLE_MS = 30_000;

export interface PublicPhotoRankingDocument
  extends FirebaseFirestore.DocumentData {
  visibility?: unknown;
  moderationStatus?: unknown;
  reactionsCount?: unknown;
  likesCount?: unknown;
  commentsCount?: unknown;
  viewsCount?: unknown;
  uniqueViewersCount?: unknown;
  qualifiedViewsCount?: unknown;
  totalQualifiedVisibleMs?: unknown;
  totalQualifiedTargetMs?: unknown;
  publishedAt?: unknown;
  score?: unknown;
  viewScore?: unknown;
  retentionScore?: unknown;
  freshnessScore?: unknown;
  engagementScore?: unknown;
  rankingVersion?: unknown;
  scoreBreakdown?: Partial<MediaScoreBreakdown> | null;
}

export interface PhotoRankingOverrides {
  reactionsCount?: unknown;
  commentsCount?: unknown;
  viewsCount?: unknown;
  uniqueViewersCount?: unknown;
  qualifiedViewsCount?: unknown;
  totalQualifiedVisibleMs?: unknown;
  totalQualifiedTargetMs?: unknown;
  publishedAt?: unknown;
}

export interface PhotoRankingUpdate {
  score: number;
  engagementScore: number;
  viewScore: number;
  retentionScore: number;
  freshnessScore: number;
  scoreBreakdown: MediaScoreBreakdown;
  qualifiedViewsCount: number;
  totalQualifiedVisibleMs: number;
  totalQualifiedTargetMs: number;
  averageQualifiedVisibleMs: number;
  rankingVersion: number;
  rankingUpdatedAt: number;
}

export interface PhotoQualificationMetrics {
  qualifiedViewsCount: number;
  totalQualifiedVisibleMs: number;
  totalQualifiedTargetMs: number;
  averageQualifiedVisibleMs: number;
}

function valueOrFallback(
  override: unknown,
  fallback: unknown
): unknown {
  return override === undefined ? fallback : override;
}

export function normalizePhotoQualifiedVisibleMs(value: unknown): number {
  const visibleMs = normalizeMediaTotal(value);

  return Math.min(PHOTO_RANKING_MAX_VISIBLE_SAMPLE_MS, visibleMs);
}

export function buildNextPhotoQualificationMetrics(input: {
  currentQualifiedViewsCount: unknown;
  currentTotalQualifiedVisibleMs: unknown;
  currentTotalQualifiedTargetMs: unknown;
  visibleMs: unknown;
  counted: boolean;
}): PhotoQualificationMetrics {
  const currentQualifiedViewsCount = normalizeMediaCount(
    input.currentQualifiedViewsCount
  );
  const currentTotalQualifiedVisibleMs = normalizeMediaTotal(
    input.currentTotalQualifiedVisibleMs
  );
  const currentTotalQualifiedTargetMs = normalizeMediaTotal(
    input.currentTotalQualifiedTargetMs
  );

  if (!input.counted) {
    return {
      qualifiedViewsCount: currentQualifiedViewsCount,
      totalQualifiedVisibleMs: currentTotalQualifiedVisibleMs,
      totalQualifiedTargetMs: currentTotalQualifiedTargetMs,
      averageQualifiedVisibleMs: currentQualifiedViewsCount > 0
        ? Math.round(
          currentTotalQualifiedVisibleMs / currentQualifiedViewsCount
        )
        : 0,
    };
  }

  const qualifiedViewsCount = currentQualifiedViewsCount + 1;
  const totalQualifiedVisibleMs = currentTotalQualifiedVisibleMs +
    normalizePhotoQualifiedVisibleMs(input.visibleMs);
  const totalQualifiedTargetMs = currentTotalQualifiedTargetMs +
    PHOTO_RANKING_QUALIFIED_VISIBLE_TARGET_MS;

  return {
    qualifiedViewsCount,
    totalQualifiedVisibleMs,
    totalQualifiedTargetMs,
    averageQualifiedVisibleMs: Math.round(
      totalQualifiedVisibleMs / qualifiedViewsCount
    ),
  };
}

export function isRankablePhoto(
  data: PublicPhotoRankingDocument
): boolean {
  return String(data.visibility ?? '').trim().toUpperCase() === 'PUBLIC' &&
    String(data.moderationStatus ?? '').trim().toUpperCase() === 'APPROVED';
}

export function buildPhotoRankingUpdate(
  data: PublicPhotoRankingDocument,
  now: number,
  overrides: PhotoRankingOverrides = {}
): PhotoRankingUpdate {
  const qualifiedViewsCount = normalizeMediaCount(
    valueOrFallback(
      overrides.qualifiedViewsCount,
      data.qualifiedViewsCount
    )
  );
  const totalQualifiedVisibleMs = normalizeMediaTotal(
    valueOrFallback(
      overrides.totalQualifiedVisibleMs,
      data.totalQualifiedVisibleMs
    )
  );
  const totalQualifiedTargetMs = normalizeMediaTotal(
    valueOrFallback(
      overrides.totalQualifiedTargetMs,
      data.totalQualifiedTargetMs
    )
  );
  const ranking = buildMediaEngagementScore({
    reactionsCount: normalizeMediaCount(
      valueOrFallback(
        overrides.reactionsCount,
        data.reactionsCount ?? data.likesCount
      )
    ),
    commentsCount: normalizeMediaCount(
      valueOrFallback(overrides.commentsCount, data.commentsCount)
    ),
    viewsCount: normalizeMediaCount(
      valueOrFallback(overrides.viewsCount, data.viewsCount)
    ),
    uniqueViewersCount: normalizeMediaCount(
      valueOrFallback(
        overrides.uniqueViewersCount,
        data.uniqueViewersCount
      )
    ),
    qualifiedViewsCount,
    totalQualifiedPlaybackMs: totalQualifiedVisibleMs,
    totalQualifiedDurationMs: totalQualifiedTargetMs,
    publishedAt: normalizeMediaTimestamp(
      valueOrFallback(overrides.publishedAt, data.publishedAt)
    ),
    now,
    currentBreakdown: data.scoreBreakdown,
  });

  return {
    score: ranking.score,
    engagementScore: ranking.engagementScore,
    viewScore: ranking.viewScore,
    retentionScore: ranking.retentionScore,
    freshnessScore: ranking.freshnessScore,
    scoreBreakdown: ranking.scoreBreakdown,
    qualifiedViewsCount,
    totalQualifiedVisibleMs,
    totalQualifiedTargetMs,
    averageQualifiedVisibleMs: qualifiedViewsCount > 0
      ? Math.round(totalQualifiedVisibleMs / qualifiedViewsCount)
      : 0,
    rankingVersion: MEDIA_RANKING_VERSION,
    rankingUpdatedAt: now,
  };
}

export function hasEquivalentPhotoRanking(
  data: PublicPhotoRankingDocument,
  update: PhotoRankingUpdate
): boolean {
  const currentBreakdown = data.scoreBreakdown ?? {};
  const nextBreakdown = update.scoreBreakdown;

  return normalizeMediaCount(data.rankingVersion) === MEDIA_RANKING_VERSION &&
    normalizeMediaScore(data.score) === update.score &&
    normalizeMediaScore(data.engagementScore) === update.engagementScore &&
    normalizeMediaScore(data.viewScore) === update.viewScore &&
    normalizeMediaScore(data.retentionScore) === update.retentionScore &&
    normalizeMediaScore(data.freshnessScore) === update.freshnessScore &&
    normalizeMediaCount(data.qualifiedViewsCount) ===
      update.qualifiedViewsCount &&
    normalizeMediaTotal(data.totalQualifiedVisibleMs) ===
      update.totalQualifiedVisibleMs &&
    normalizeMediaTotal(data.totalQualifiedTargetMs) ===
      update.totalQualifiedTargetMs &&
    normalizeMediaScore(currentBreakdown.rankingScore) ===
      nextBreakdown.rankingScore &&
    normalizeMediaScore(currentBreakdown.qualityScore) ===
      nextBreakdown.qualityScore &&
    normalizeMediaScore(currentBreakdown.engagementScore) ===
      nextBreakdown.engagementScore &&
    normalizeMediaScore(currentBreakdown.viewScore) ===
      nextBreakdown.viewScore &&
    normalizeMediaScore(currentBreakdown.retentionScore) ===
      nextBreakdown.retentionScore &&
    normalizeMediaScore(currentBreakdown.freshnessScore) ===
      nextBreakdown.freshnessScore &&
    normalizeMediaScore(currentBreakdown.safetyScore) ===
      nextBreakdown.safetyScore;
}
