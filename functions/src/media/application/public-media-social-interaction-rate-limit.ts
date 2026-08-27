import {
  buildBackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitConfig,
  type BackendFixedWindowRateLimitDecision,
  type BackendFixedWindowRateLimitState,
} from './backend-fixed-window-rate-limit';

export type PublicMediaSocialInteractionKind =
  | 'reaction'
  | 'comment'
  | 'rating';

export const PUBLIC_MEDIA_REACTION_RATE_LIMIT_CONFIG: BackendFixedWindowRateLimitConfig = {
  burstWindowMs: 60 * 1000,
  burstMax: 30,
  sustainedWindowMs: 10 * 60 * 1000,
  sustainedMax: 120,
};

export const PUBLIC_MEDIA_COMMENT_RATE_LIMIT_CONFIG: BackendFixedWindowRateLimitConfig = {
  burstWindowMs: 60 * 1000,
  burstMax: 12,
  sustainedWindowMs: 10 * 60 * 1000,
  sustainedMax: 48,
};

export const PUBLIC_MEDIA_RATING_RATE_LIMIT_CONFIG: BackendFixedWindowRateLimitConfig = {
  burstWindowMs: 60 * 1000,
  burstMax: 20,
  sustainedWindowMs: 10 * 60 * 1000,
  sustainedMax: 80,
};

export type PublicMediaSocialInteractionRateLimitState =
  BackendFixedWindowRateLimitState;
export type PublicMediaSocialInteractionRateLimitDecision =
  BackendFixedWindowRateLimitDecision;

export function getPublicMediaSocialInteractionRateLimitConfig(
  kind: PublicMediaSocialInteractionKind
): BackendFixedWindowRateLimitConfig {
  if (kind === 'reaction') {
    return PUBLIC_MEDIA_REACTION_RATE_LIMIT_CONFIG;
  }

  if (kind === 'comment') {
    return PUBLIC_MEDIA_COMMENT_RATE_LIMIT_CONFIG;
  }

  return PUBLIC_MEDIA_RATING_RATE_LIMIT_CONFIG;
}

export function buildPublicMediaSocialInteractionRateLimitDecision(input: {
  now: number;
  kind: PublicMediaSocialInteractionKind;
  state?: PublicMediaSocialInteractionRateLimitState | null;
}): PublicMediaSocialInteractionRateLimitDecision {
  return buildBackendFixedWindowRateLimitDecision({
    now: input.now,
    state: input.state,
    cost: 1,
    config: getPublicMediaSocialInteractionRateLimitConfig(input.kind),
  });
}
