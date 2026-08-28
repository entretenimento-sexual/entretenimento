export const VIDEO_VIEW_MIN_PLAYBACK_MS = 3_000;
export const VIDEO_VIEW_MAX_PLAYBACK_MS = 10_000;
export const VIDEO_VIEW_PLAYBACK_RATIO = 0.25;
export const VIDEO_VIEW_SHORT_VIDEO_RATIO = 0.8;
export const VIDEO_VIEW_COUNT_INTERVAL_MS = 30 * 60 * 1000;
export const VIDEO_VIEW_COUNT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const VIDEO_VIEW_MAX_COUNTS_PER_WINDOW = 3;

const MIN_SESSION_ID_LENGTH = 16;
const MAX_SESSION_ID_LENGTH = 128;
const QUALIFIED_AT_FUTURE_TOLERANCE_MS = 60_000;
const QUALIFIED_AT_MAX_AGE_MS = 10 * 60 * 1000;

export interface VideoViewPlaybackEvidenceInput {
  sessionId?: unknown;
  playbackMs?: unknown;
  durationMs?: unknown;
  qualifiedAt?: unknown;
}

export interface QualifiedVideoViewEvidence {
  sessionId: string;
  playbackMs: number;
  durationMs: number;
  qualifiedAt: number;
  requiredPlaybackMs: number;
}

export interface VideoViewCountDecisionInput {
  now: number;
  isUniqueViewer: boolean;
  lastCountedAt: number;
  countWindowStartedAt: number;
  countWindowCount: number;
  samePlaybackSession: boolean;
}

export interface VideoViewCountDecision {
  canCount: boolean;
  retryAfterMs: number;
  nextCountWindowStartedAt: number;
  nextCountWindowCount: number;
}

function finiteNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return value;
}

export function calculateRequiredVideoPlaybackMs(durationMs: number): number {
  const safeDurationMs = Number.isFinite(durationMs)
    ? Math.max(0, durationMs)
    : 0;

  if (safeDurationMs <= 0) {
    return VIDEO_VIEW_MIN_PLAYBACK_MS;
  }

  const standardThreshold = Math.max(
    VIDEO_VIEW_MIN_PLAYBACK_MS,
    Math.min(
      VIDEO_VIEW_MAX_PLAYBACK_MS,
      safeDurationMs * VIDEO_VIEW_PLAYBACK_RATIO
    )
  );
  const shortVideoThreshold = safeDurationMs * VIDEO_VIEW_SHORT_VIDEO_RATIO;

  return Math.max(
    250,
    Math.round(Math.min(standardThreshold, shortVideoThreshold))
  );
}

export function normalizeVideoViewPlaybackEvidence(input: {
  evidence: VideoViewPlaybackEvidenceInput | null | undefined;
  serverDurationMs: number;
  now: number;
}): QualifiedVideoViewEvidence | null {
  const evidence = input.evidence;
  const serverDurationMs = finiteNonNegativeNumber(input.serverDurationMs);
  const now = finiteNonNegativeNumber(input.now);

  if (!evidence || !serverDurationMs || !now) {
    return null;
  }

  const sessionId = String(evidence.sessionId ?? '').trim();
  const playbackMs = finiteNonNegativeNumber(evidence.playbackMs);
  const reportedDurationMs = finiteNonNegativeNumber(evidence.durationMs);
  const qualifiedAt = finiteNonNegativeNumber(evidence.qualifiedAt);

  if (
    sessionId.length < MIN_SESSION_ID_LENGTH ||
    sessionId.length > MAX_SESSION_ID_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(sessionId) ||
    playbackMs === null ||
    reportedDurationMs === null ||
    qualifiedAt === null
  ) {
    return null;
  }

  const durationToleranceMs = Math.max(3_000, serverDurationMs * 0.15);

  if (Math.abs(reportedDurationMs - serverDurationMs) > durationToleranceMs) {
    return null;
  }

  const requiredPlaybackMs = calculateRequiredVideoPlaybackMs(serverDurationMs);

  if (
    playbackMs < requiredPlaybackMs ||
    playbackMs > serverDurationMs + 5_000 ||
    qualifiedAt > now + QUALIFIED_AT_FUTURE_TOLERANCE_MS ||
    now - qualifiedAt > QUALIFIED_AT_MAX_AGE_MS
  ) {
    return null;
  }

  return {
    sessionId,
    playbackMs: Math.round(playbackMs),
    durationMs: Math.round(reportedDurationMs),
    qualifiedAt: Math.round(qualifiedAt),
    requiredPlaybackMs,
  };
}

export function buildVideoViewCountDecision(
  input: VideoViewCountDecisionInput
): VideoViewCountDecision {
  const now = Math.max(0, input.now);
  const lastCountedAt = Math.max(0, input.lastCountedAt);
  const existingWindowStartedAt = Math.max(0, input.countWindowStartedAt);
  const existingWindowCount = Math.max(0, Math.floor(input.countWindowCount));
  const windowExpired =
    existingWindowStartedAt <= 0 ||
    now - existingWindowStartedAt >= VIDEO_VIEW_COUNT_WINDOW_MS;
  const windowStartedAt = windowExpired ? now : existingWindowStartedAt;
  const windowCount = windowExpired ? 0 : existingWindowCount;
  const intervalRemainingMs = Math.max(
    0,
    VIDEO_VIEW_COUNT_INTERVAL_MS - (now - lastCountedAt)
  );
  const windowRemainingMs = Math.max(
    0,
    VIDEO_VIEW_COUNT_WINDOW_MS - (now - windowStartedAt)
  );
  const reachedWindowLimit =
    windowCount >= VIDEO_VIEW_MAX_COUNTS_PER_WINDOW;
  const canCount =
    !input.samePlaybackSession &&
    (input.isUniqueViewer || intervalRemainingMs === 0) &&
    !reachedWindowLimit;

  if (canCount) {
    return {
      canCount: true,
      retryAfterMs: VIDEO_VIEW_COUNT_INTERVAL_MS,
      nextCountWindowStartedAt: windowStartedAt,
      nextCountWindowCount: windowCount + 1,
    };
  }

  return {
    canCount: false,
    retryAfterMs: input.samePlaybackSession
      ? windowRemainingMs
      : reachedWindowLimit
        ? windowRemainingMs
        : intervalRemainingMs,
    nextCountWindowStartedAt: windowStartedAt,
    nextCountWindowCount: windowCount,
  };
}
