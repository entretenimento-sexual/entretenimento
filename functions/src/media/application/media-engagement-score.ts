export interface MediaScoreBreakdown {
  rankingScore: number;
  qualityScore: number;
  engagementScore: number;
  safetyScore: number;
}

export interface MediaEngagementInput {
  reactionsCount: number;
  commentsCount: number;
  ratingsCount?: number;
  ratingAverage?: number;
  currentBreakdown?: Partial<MediaScoreBreakdown> | null;
}

export interface MediaEngagementResult {
  score: number;
  engagementScore: number;
  scoreBreakdown: MediaScoreBreakdown;
}

export function normalizeMediaCount(value: unknown): number {
  const count = Number(value ?? 0);

  if (!Number.isFinite(count) || count < 0) {
    return 0;
  }

  return Math.floor(count);
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
  const scoreBreakdown: MediaScoreBreakdown = {
    qualityScore: normalizeMediaScore(currentBreakdown.qualityScore ?? 0),
    safetyScore: normalizeMediaScore(currentBreakdown.safetyScore ?? 100),
    engagementScore,
    rankingScore: 0,
  };

  scoreBreakdown.rankingScore = normalizeMediaScore(
    Math.round(
      scoreBreakdown.qualityScore * 0.25 +
      scoreBreakdown.engagementScore * 0.45 +
      scoreBreakdown.safetyScore * 0.30
    )
  );

  return {
    score: scoreBreakdown.rankingScore,
    engagementScore,
    scoreBreakdown,
  };
}
