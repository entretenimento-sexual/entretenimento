// functions/src/media/application/public-video-playback-plan.policy.ts
// -----------------------------------------------------------------------------
// PUBLIC VIDEO PLAYBACK PLAN POLICY
// -----------------------------------------------------------------------------
// A exigência de plano é independente da visibilidade da publicação. PUBLIC
// define onde o vídeo pode aparecer; minimumPlaybackPlan define quem recebe a
// URL de reprodução completa. O padrão permanece gratuito até decisão comercial.
// -----------------------------------------------------------------------------

import { hasMinimumActiveDiscoveryPlan } from '../../discovery/discovery-subscription-access';

export type PublicVideoMinimumPlaybackPlan =
  | 'free'
  | 'basic'
  | 'premium'
  | 'vip';

export function normalizePublicVideoMinimumPlaybackPlan(
  value: unknown
): PublicVideoMinimumPlaybackPlan {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (
    normalized === 'basic'
    || normalized === 'premium'
    || normalized === 'vip'
  ) {
    return normalized;
  }

  return 'free';
}

export function hasPublicVideoPlaybackPlan(
  rawUser: unknown,
  minimumPlanValue: unknown,
  now = Date.now()
): boolean {
  const minimumPlan = normalizePublicVideoMinimumPlaybackPlan(
    minimumPlanValue
  );

  if (minimumPlan === 'free') {
    return true;
  }

  const user = (rawUser ?? {}) as Record<string, unknown>;

  if (String(user['role'] ?? '').trim().toLowerCase() === 'admin') {
    return true;
  }

  return hasMinimumActiveDiscoveryPlan(user, minimumPlan, now);
}
