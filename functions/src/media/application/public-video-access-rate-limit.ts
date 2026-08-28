import {
  buildBackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitState,
} from './backend-fixed-window-rate-limit';

export const PUBLIC_VIDEO_ACCESS_BURST_WINDOW_MS = 60 * 1000;
export const PUBLIC_VIDEO_ACCESS_BURST_MAX_ITEMS = 96;
export const PUBLIC_VIDEO_ACCESS_SUSTAINED_WINDOW_MS = 10 * 60 * 1000;
export const PUBLIC_VIDEO_ACCESS_SUSTAINED_MAX_ITEMS = 480;

export type PublicVideoAccessRateLimitState = BackendFixedWindowRateLimitState;
export type PublicVideoAccessRateLimitDecision = BackendFixedWindowRateLimitDecision;

export function buildPublicVideoAccessRateLimitDecision(input: {
  now: number;
  itemCount: number;
  state?: PublicVideoAccessRateLimitState | null;
}): PublicVideoAccessRateLimitDecision {
  return buildBackendFixedWindowRateLimitDecision({
    now: input.now,
    state: input.state,
    cost: input.itemCount,
    config: {
      burstWindowMs: PUBLIC_VIDEO_ACCESS_BURST_WINDOW_MS,
      burstMax: PUBLIC_VIDEO_ACCESS_BURST_MAX_ITEMS,
      sustainedWindowMs: PUBLIC_VIDEO_ACCESS_SUSTAINED_WINDOW_MS,
      sustainedMax: PUBLIC_VIDEO_ACCESS_SUSTAINED_MAX_ITEMS,
    },
  });
}
