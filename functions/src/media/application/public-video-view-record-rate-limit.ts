import {
  buildBackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitState,
  type NormalizedBackendFixedWindowRateLimitState,
} from './backend-fixed-window-rate-limit';
import { PUBLIC_MEDIA_VIEW_RECORD_RATE_LIMIT_CONFIG } from './public-media-rate-limit.config';

export const PUBLIC_VIDEO_VIEW_RECORD_BURST_WINDOW_MS =
  PUBLIC_MEDIA_VIEW_RECORD_RATE_LIMIT_CONFIG.burstWindowMs;
export const PUBLIC_VIDEO_VIEW_RECORD_BURST_MAX =
  PUBLIC_MEDIA_VIEW_RECORD_RATE_LIMIT_CONFIG.burstMax;
export const PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_WINDOW_MS =
  PUBLIC_MEDIA_VIEW_RECORD_RATE_LIMIT_CONFIG.sustainedWindowMs;
export const PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_MAX =
  PUBLIC_MEDIA_VIEW_RECORD_RATE_LIMIT_CONFIG.sustainedMax;

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
    config: PUBLIC_MEDIA_VIEW_RECORD_RATE_LIMIT_CONFIG,
  });
}
