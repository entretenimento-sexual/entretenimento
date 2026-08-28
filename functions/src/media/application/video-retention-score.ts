import { normalizeMediaScore } from './media-engagement-score';

export const VIDEO_RETENTION_COMPLETION_BASIS_POINTS = 9_000;
export const VIDEO_RETENTION_MAX_BASIS_POINTS = 10_000;
const RETENTION_FULL_CONFIDENCE_VIEWERS = 5;

export interface VideoRetentionAggregateInput {
  readonly currentContributorsCount: unknown;
  readonly currentBasisPointsTotal: unknown;
  readonly currentCompletionViewersCount: unknown;
  readonly previousViewerBasisPoints: unknown;
  readonly playbackMs: unknown;
  readonly durationMs: unknown;
}

export interface VideoRetentionAggregateResult {
  readonly improved: boolean;
  readonly viewerBasisPoints: number;
  readonly contributorsCount: number;
  readonly basisPointsTotal: number;
  readonly averagePercent: number;
  readonly completionViewersCount: number;
  readonly completionRate: number;
  readonly retentionScore: number;
}

/**
 * Progresso efetivamente reproduzido pelo viewer em basis points (0..10000).
 * O backend só chama este helper depois de validar a evidência e a identidade.
 */
export function calculateVideoRetentionBasisPoints(
  playbackMs: unknown,
  durationMs: unknown
): number {
  const playback = normalizePositiveNumber(playbackMs);
  const duration = normalizePositiveNumber(durationMs);

  if (!playback || !duration) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      VIDEO_RETENTION_MAX_BASIS_POINTS,
      Math.round((playback / duration) * VIDEO_RETENTION_MAX_BASIS_POINTS)
    )
  );
}

/**
 * Atualiza o agregado usando somente a melhora do melhor progresso por viewer.
 * Repetir o mesmo vídeo não multiplica retenção; no máximo substitui o melhor
 * progresso anterior daquele usuário.
 */
export function buildVideoRetentionAggregate(
  input: VideoRetentionAggregateInput
): VideoRetentionAggregateResult {
  const currentContributorsCount = normalizeCount(
    input.currentContributorsCount
  );
  const currentBasisPointsTotal = normalizeCount(
    input.currentBasisPointsTotal
  );
  const currentCompletionViewersCount = normalizeCount(
    input.currentCompletionViewersCount
  );
  const previousViewerBasisPoints = Math.min(
    VIDEO_RETENTION_MAX_BASIS_POINTS,
    normalizeCount(input.previousViewerBasisPoints)
  );
  const reportedBasisPoints = calculateVideoRetentionBasisPoints(
    input.playbackMs,
    input.durationMs
  );
  const viewerBasisPoints = Math.max(
    previousViewerBasisPoints,
    reportedBasisPoints
  );
  const improved = viewerBasisPoints > previousViewerBasisPoints;
  const isNewContributor = previousViewerBasisPoints === 0 && viewerBasisPoints > 0;
  const crossedCompletion =
    previousViewerBasisPoints < VIDEO_RETENTION_COMPLETION_BASIS_POINTS &&
    viewerBasisPoints >= VIDEO_RETENTION_COMPLETION_BASIS_POINTS;
  const contributorsCount = currentContributorsCount +
    (isNewContributor ? 1 : 0);
  const basisPointsTotal = currentBasisPointsTotal +
    Math.max(0, viewerBasisPoints - previousViewerBasisPoints);
  const completionViewersCount = currentCompletionViewersCount +
    (crossedCompletion ? 1 : 0);
  const averagePercent = contributorsCount > 0
    ? normalizeMediaScore(
      Math.round(basisPointsTotal / contributorsCount / 100)
    )
    : 0;
  const confidence = Math.min(
    1,
    contributorsCount / RETENTION_FULL_CONFIDENCE_VIEWERS
  );
  const retentionScore = normalizeMediaScore(
    Math.round(averagePercent * confidence)
  );
  const completionRate = contributorsCount > 0
    ? normalizeMediaScore(
      Math.round((completionViewersCount / contributorsCount) * 100)
    )
    : 0;

  return {
    improved,
    viewerBasisPoints,
    contributorsCount,
    basisPointsTotal,
    averagePercent,
    completionViewersCount,
    completionRate,
    retentionScore,
  };
}

function normalizeCount(value: unknown): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : 0;
}

function normalizePositiveNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
