// src/app/core/services/subscriptions/platform-subscription-access.model.ts
// -----------------------------------------------------------------------------
// CANONICAL PLATFORM SUBSCRIPTION ACCESS
// -----------------------------------------------------------------------------
// O frontend nunca concede acesso a partir de role, selo ou uma única flag.
// Ele consome somente a projeção versionada produzida a partir do entitlement.
// -----------------------------------------------------------------------------

import type { IUserDados } from '../../interfaces/iuser-dados';
import { toEpoch } from '../../utils/epoch-utils';

export const PLATFORM_SUBSCRIPTION_PROJECTION_VERSION = 1;

export type PlatformSubscriptionRole = 'basic' | 'premium' | 'vip';

export type PlatformSubscriptionInactiveReason =
  | 'missing-user'
  | 'projection-version'
  | 'inactive-flag'
  | 'inactive-status'
  | 'invalid-scope'
  | 'invalid-role'
  | 'invalid-period'
  | 'not-started'
  | 'expired';

export interface PlatformSubscriptionAccessState {
  readonly active: boolean;
  readonly role: PlatformSubscriptionRole | null;
  readonly startsAt: number | null;
  readonly endsAt: number | null;
  readonly projectionVersion: number | null;
  readonly reason: PlatformSubscriptionInactiveReason | null;
}

export function isPlatformSubscriptionRole(
  value: unknown
): value is PlatformSubscriptionRole {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

function toFiniteEpoch(value: unknown): number | null {
  const epoch = toEpoch(value as never);
  return typeof epoch === 'number' && Number.isFinite(epoch) ? epoch : null;
}

function inactiveState(
  reason: PlatformSubscriptionInactiveReason,
  params: {
    role?: PlatformSubscriptionRole | null;
    startsAt?: number | null;
    endsAt?: number | null;
    projectionVersion?: number | null;
  } = {}
): PlatformSubscriptionAccessState {
  return {
    active: false,
    role: null,
    startsAt: params.startsAt ?? null,
    endsAt: params.endsAt ?? null,
    projectionVersion: params.projectionVersion ?? null,
    reason,
  };
}

export function evaluatePlatformSubscriptionProjection(
  user: IUserDados | null | undefined,
  now = Date.now()
): PlatformSubscriptionAccessState {
  if (!user) {
    return inactiveState('missing-user');
  }

  const projectionVersion =
    typeof user.billingProjectionVersion === 'number' &&
    Number.isFinite(user.billingProjectionVersion)
      ? user.billingProjectionVersion
      : null;
  const startsAt = toFiniteEpoch(user.subscriptionStartedAt);
  const endsAt = toFiniteEpoch(user.subscriptionEndsAt);
  const roleCandidate = user.tier ?? user.role;
  const role = isPlatformSubscriptionRole(roleCandidate)
    ? roleCandidate
    : null;

  if (projectionVersion !== PLATFORM_SUBSCRIPTION_PROJECTION_VERSION) {
    return inactiveState('projection-version', {
      startsAt,
      endsAt,
      projectionVersion,
    });
  }

  if (user.isSubscriber !== true) {
    return inactiveState('inactive-flag', {
      startsAt,
      endsAt,
      projectionVersion,
    });
  }

  if (user.subscriptionStatus !== 'active') {
    return inactiveState('inactive-status', {
      startsAt,
      endsAt,
      projectionVersion,
    });
  }

  if (user.subscriptionScope !== 'platform_subscription') {
    return inactiveState('invalid-scope', {
      startsAt,
      endsAt,
      projectionVersion,
    });
  }

  if (!role) {
    return inactiveState('invalid-role', {
      startsAt,
      endsAt,
      projectionVersion,
    });
  }

  if (startsAt === null || endsAt === null || startsAt >= endsAt) {
    return inactiveState('invalid-period', {
      startsAt,
      endsAt,
      projectionVersion,
    });
  }

  if (now < startsAt) {
    return inactiveState('not-started', {
      role,
      startsAt,
      endsAt,
      projectionVersion,
    });
  }

  if (now >= endsAt) {
    return inactiveState('expired', {
      role,
      startsAt,
      endsAt,
      projectionVersion,
    });
  }

  return {
    active: true,
    role,
    startsAt,
    endsAt,
    projectionVersion,
    reason: null,
  };
}

export function hasMinimumPlatformSubscriptionRole(
  currentRole: PlatformSubscriptionRole | null,
  minimumRole: PlatformSubscriptionRole
): boolean {
  const rank: Readonly<Record<PlatformSubscriptionRole, number>> = {
    basic: 1,
    premium: 2,
    vip: 3,
  };

  return currentRole !== null && rank[currentRole] >= rank[minimumRole];
}
