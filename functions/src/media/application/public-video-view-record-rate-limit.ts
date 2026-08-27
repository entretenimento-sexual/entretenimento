import {
  buildBackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitState,
  type NormalizedBackendFixedWindowRateLimitState,
} from './backend-fixed-window-rate-limit';

export const PUBLIC_VIDEO_VIEW_RECORD_BURST_WINDOW_MS = 60 * 1000;
export const PUBLIC_VIDEO_VIEW_RECORD_BURST_MAX = 60;
export const PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
export const PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_MAX = 360;

export type PublicVideoViewRecordRateLimitState =
  BackendFixedWindowRateLimitState;
export type NormalizedPublicVideoViewRecordRateLimitState =
  NormalizedBackendFixedWindowRateLimitState;
export type PublicVideoViewRecordRateLimitDecision =
  BackendFixedWindowRateLimitDecision;

export function buildPublicVideoViewRecordRateLimitDecision(input: {
  now: number;
  state?: PublicVideoViewRecordRateLimitState | null;
}): PublicVideoViewRecordRateLimitDecision {
  return buildBackendFixedWindowRateLimitDecision({
    now: input.now,
    state: input.state,
    cost: 1,
    config: {
      burstWindowMs: PUBLIC_VIDEO_VIEW_RECORD_BURST_WINDOW_MS,
      burstMax: PUBLIC_VIDEO_VIEW_RECORD_BURST_MAX,
      sustainedWindowMs: PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_WINDOW_MS,
      sustainedMax: PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_MAX,
    },
  });
}
