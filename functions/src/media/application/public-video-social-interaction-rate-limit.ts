import {
  PUBLIC_MEDIA_COMMENT_RATE_LIMIT_CONFIG,
  PUBLIC_MEDIA_RATING_RATE_LIMIT_CONFIG,
  PUBLIC_MEDIA_REACTION_RATE_LIMIT_CONFIG,
  buildPublicMediaSocialInteractionRateLimitDecision,
  getPublicMediaSocialInteractionRateLimitConfig,
  type PublicMediaSocialInteractionKind,
  type PublicMediaSocialInteractionRateLimitDecision,
  type PublicMediaSocialInteractionRateLimitState,
} from './public-media-social-interaction-rate-limit';

export type PublicVideoSocialInteractionKind = PublicMediaSocialInteractionKind;

export const PUBLIC_VIDEO_REACTION_RATE_LIMIT_CONFIG =
  PUBLIC_MEDIA_REACTION_RATE_LIMIT_CONFIG;
export const PUBLIC_VIDEO_COMMENT_RATE_LIMIT_CONFIG =
  PUBLIC_MEDIA_COMMENT_RATE_LIMIT_CONFIG;
export const PUBLIC_VIDEO_RATING_RATE_LIMIT_CONFIG =
  PUBLIC_MEDIA_RATING_RATE_LIMIT_CONFIG;

export type PublicVideoSocialInteractionRateLimitState =
  PublicMediaSocialInteractionRateLimitState;
export type PublicVideoSocialInteractionRateLimitDecision =
  PublicMediaSocialInteractionRateLimitDecision;

export const getPublicVideoSocialInteractionRateLimitConfig =
  getPublicMediaSocialInteractionRateLimitConfig;

export function buildPublicVideoSocialInteractionRateLimitDecision(input: {
  now: number;
  kind: PublicVideoSocialInteractionKind;
  state?: PublicVideoSocialInteractionRateLimitState | null;
}): PublicVideoSocialInteractionRateLimitDecision {
  return buildPublicMediaSocialInteractionRateLimitDecision(input);
}
