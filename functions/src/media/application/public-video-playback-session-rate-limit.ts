import {
  buildBackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitState,
  type NormalizedBackendFixedWindowRateLimitState,
} from './backend-fixed-window-rate-limit';

export const PUBLIC_VIDEO_PLAYBACK_BURST_WINDOW_MS = 60 * 1000;
export const PUBLIC_VIDEO_PLAYBACK_BURST_MAX = 30;
export const PUBLIC_VIDEO_PLAYBACK_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
export const PUBLIC_VIDEO_PLAYBACK_SUSTAINED_MAX = 240;

export type PublicVideoPlaybackRateLimitState =
  BackendFixedWindowRateLimitState;
export type NormalizedPublicVideoPlaybackRateLimitState =
  NormalizedBackendFixedWindowRateLimitState;
export type PublicVideoPlaybackRateLimitDecision =
  BackendFixedWindowRateLimitDecision;

export function buildPublicVideoPlaybackRateLimitDecision(input: {
  now: number;
  state?: PublicVideoPlaybackRateLimitState | null;
}): PublicVideoPlaybackRateLimitDecision {
  return buildBackendFixedWindowRateLimitDecision({
    now: input.now,
    state: input.state,
    cost: 1,
    config: {
      burstWindowMs: PUBLIC_VIDEO_PLAYBACK_BURST_WINDOW_MS,
      burstMax: PUBLIC_VIDEO_PLAYBACK_BURST_MAX,
      sustainedWindowMs: PUBLIC_VIDEO_PLAYBACK_SUSTAINED_WINDOW_MS,
      sustainedMax: PUBLIC_VIDEO_PLAYBACK_SUSTAINED_MAX,
    },
  });
}
