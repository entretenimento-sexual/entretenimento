import {
  buildBackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitState,
} from './backend-fixed-window-rate-limit';
import { PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG } from './public-media-rate-limit.config';

export const PUBLIC_VIDEO_ACCESS_BURST_WINDOW_MS =
  PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG.burstWindowMs;
export const PUBLIC_VIDEO_ACCESS_BURST_MAX_ITEMS =
  PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG.burstMax;
export const PUBLIC_VIDEO_ACCESS_SUSTAINED_WINDOW_MS =
  PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG.sustainedWindowMs;
export const PUBLIC_VIDEO_ACCESS_SUSTAINED_MAX_ITEMS =
  PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG.sustainedMax;

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
    config: PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG,
  });
}
