import type { BackendFixedWindowRateLimitConfig } from './backend-fixed-window-rate-limit';

export const PUBLIC_MEDIA_ACCESS_RATE_LIMIT_CONFIG: BackendFixedWindowRateLimitConfig =
  Object.freeze({
    burstWindowMs: 60 * 1000,
    burstMax: 144,
    sustainedWindowMs: 10 * 60 * 1000,
    sustainedMax: 720,
  });

export const PUBLIC_MEDIA_VIEW_RECORD_RATE_LIMIT_CONFIG: BackendFixedWindowRateLimitConfig =
  Object.freeze({
    burstWindowMs: 60 * 1000,
    burstMax: 60,
    sustainedWindowMs: 10 * 60 * 1000,
    sustainedMax: 360,
  });

export const PUBLIC_MEDIA_REPORT_RATE_LIMIT_CONFIG: BackendFixedWindowRateLimitConfig =
  Object.freeze({
    burstWindowMs: 60 * 1000,
    burstMax: 12,
    sustainedWindowMs: 10 * 60 * 1000,
    sustainedMax: 48,
  });
