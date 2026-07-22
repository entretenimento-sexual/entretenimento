// src/app/core/services/subscriptions/platform-subscription-access.policy.ts
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION ACCESS POLICY
// -----------------------------------------------------------------------------
// Avalia exclusivamente a projeção operacional produzida a partir do entitlement
// determinístico do backend. Booleans, role e aliases legados isolados nunca
// concedem acesso.
// -----------------------------------------------------------------------------

import type { IUserDados, UserTierRole } from '../../interfaces/iuser-dados';

export const PLATFORM_SUBSCRIPTION_PROJECTION_VERSION = 1;

export type PlatformSubscriptionRole = 'basic' | 'premium' | 'vip';

export interface PlatformSubscriptionAccessState {
  readonly resolved: boolean;
  readonly active: boolean;
  readonly role: PlatformSubscriptionRole | null;
  readonly startsAt: number | null;
  readonly endsAt: number | null;
  readonly projectionVersion: number | null;
}

const ROLE_WEIGHT: Readonly<Record<PlatformSubscriptionRole, number>> =
  Object.freeze({
    basic: 1,
    premium: 2,
    vip: 3,
  });

function isPlatformRole(value: unknown): value is PlatformSubscriptionRole {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

/**
 * Firestore Timestamp pode chegar como Timestamp real, objeto serializado,
 * Date ou epoch ms dependendo do converter/cache. Esta função não aceita
 * strings de data para evitar interpretações dependentes de navegador/locale.
 */
export function subscriptionTimeToMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  if (!value || typeof value !== 'object') return null;

  const timestampLike = value as {
    toMillis?: () => unknown;
    seconds?: unknown;
    nanoseconds?: unknown;
    _seconds?: unknown;
    _nanoseconds?: unknown;
  };

  if (typeof timestampLike.toMillis === 'function') {
    try {
      const millis = timestampLike.toMillis();
      return typeof millis === 'number' && Number.isFinite(millis)
        ? millis
        : null;
    } catch {
      return null;
    }
  }

  const seconds =
    typeof timestampLike.seconds === 'number'
      ? timestampLike.seconds
      : typeof timestampLike._seconds === 'number'
        ? timestampLike._seconds
        : null;
  const nanoseconds =
    typeof timestampLike.nanoseconds === 'number'
      ? timestampLike.nanoseconds
      : typeof timestampLike._nanoseconds === 'number'
        ? timestampLike._nanoseconds
        : 0;

  if (seconds === null || !Number.isFinite(seconds)) return null;
  if (!Number.isFinite(nanoseconds)) return null;

  return seconds * 1000 + Math.floor(nanoseconds / 1_000_000);
}

export function evaluatePlatformSubscriptionAccess(
  user: IUserDados | null | undefined,
  now = Date.now()
): PlatformSubscriptionAccessState {
  if (user === undefined) {
    return {
      resolved: false,
      active: false,
      role: null,
      startsAt: null,
      endsAt: null,
      projectionVersion: null,
    };
  }

  const projectionVersion =
    typeof user?.billingProjectionVersion === 'number' &&
    Number.isFinite(user.billingProjectionVersion)
      ? user.billingProjectionVersion
      : null;
  const startsAt = subscriptionTimeToMillis(user?.subscriptionStartedAt);
  const endsAt = subscriptionTimeToMillis(user?.subscriptionEndsAt);
  const roleCandidate: UserTierRole | null = user?.tier ?? user?.role ?? null;
  const role = isPlatformRole(roleCandidate) ? roleCandidate : null;

  const active =
    user !== null &&
    projectionVersion !== null &&
    projectionVersion >= PLATFORM_SUBSCRIPTION_PROJECTION_VERSION &&
    user.isSubscriber === true &&
    user.subscriptionStatus === 'active' &&
    user.subscriptionScope === 'platform_subscription' &&
    role !== null &&
    startsAt !== null &&
    startsAt <= now &&
    endsAt !== null &&
    endsAt > now;

  return {
    resolved: true,
    active,
    role: active ? role : null,
    startsAt,
    endsAt,
    projectionVersion,
  };
}

export function hasMinimumPlatformSubscriptionRole(
  state: PlatformSubscriptionAccessState,
  minimumRole: PlatformSubscriptionRole
): boolean {
  return (
    state.active &&
    state.role !== null &&
    ROLE_WEIGHT[state.role] >= ROLE_WEIGHT[minimumRole]
  );
}
