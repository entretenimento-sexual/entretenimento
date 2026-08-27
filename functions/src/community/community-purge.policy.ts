// functions/src/community/community-purge.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE POLICY
// -----------------------------------------------------------------------------
// Decide se uma Comunidade já pode entrar na purga física definitiva.
// Não executa I/O. A decisão é deliberadamente conservadora: ausência de
// métricas confiáveis, holds, grace period ou moderação pendente bloqueiam purge.
// -----------------------------------------------------------------------------

import { hasCommunityLifecycleHold } from './community-lifecycle.policy';

const DAY_MS = 24 * 60 * 60 * 1_000;

export const DEFAULT_COMMUNITY_PURGE_GRACE_DAYS = 30;
export const COMMUNITY_PURGE_POLICY_VERSION = 1;

export type CommunityPurgeBlockReason =
  | 'eligible'
  | 'not_community'
  | 'status_not_scheduled'
  | 'lifecycle_hold'
  | 'member_count_unknown'
  | 'members_present'
  | 'missing_schedule_anchor'
  | 'grace_period'
  | 'moderation_reference_hold';

export interface CommunityPurgeDecision {
  eligible: boolean;
  reason: CommunityPurgeBlockReason;
  scheduledForDeletionAt: number | null;
  purgeEligibleAt: number | null;
  graceDays: number;
  policyVersion: number;
}

export interface CommunityPurgeEligibilityContext {
  hasBlockingModerationReference?: boolean;
}

function normalizeTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.trunc(value) : null;
  }

  if (value && typeof value === 'object') {
    const source = value as {
      toMillis?: () => number;
      seconds?: unknown;
      nanoseconds?: unknown;
    };

    if (typeof source.toMillis === 'function') {
      const millis = Number(source.toMillis());
      return Number.isFinite(millis) && millis > 0
        ? Math.trunc(millis)
        : null;
    }

    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const millis = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(millis) && millis > 0
        ? Math.trunc(millis)
        : null;
    }
  }

  return null;
}

function normalizeMemberCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? Math.trunc(value)
    : null;
}

function normalizeInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, minimum), maximum)
    : fallback;
}

export function resolveCommunityPurgeGraceDays(rawConfig: unknown): number {
  const config = (rawConfig ?? {}) as Record<string, unknown>;

  return normalizeInteger(
    config['lifecyclePurgeGraceDays'],
    DEFAULT_COMMUNITY_PURGE_GRACE_DAYS,
    7,
    365
  );
}

function blocked(
  reason: Exclude<CommunityPurgeBlockReason, 'eligible'>,
  graceDays: number,
  scheduledForDeletionAt: number | null,
  purgeEligibleAt: number | null
): CommunityPurgeDecision {
  return {
    eligible: false,
    reason,
    scheduledForDeletionAt,
    purgeEligibleAt,
    graceDays,
    policyVersion: COMMUNITY_PURGE_POLICY_VERSION,
  };
}

export function evaluateCommunityPurgeEligibility(
  rawCommunity: unknown,
  now: number,
  graceDays = DEFAULT_COMMUNITY_PURGE_GRACE_DAYS,
  context: Readonly<CommunityPurgeEligibilityContext> = {}
): CommunityPurgeDecision {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;
  const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;
  const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;
  const safeGraceDays = normalizeInteger(
    graceDays,
    DEFAULT_COMMUNITY_PURGE_GRACE_DAYS,
    7,
    365
  );

  if (source['type'] !== 'community') {
    return blocked('not_community', safeGraceDays, null, null);
  }

  if (community['status'] !== 'scheduled_for_deletion') {
    return blocked('status_not_scheduled', safeGraceDays, null, null);
  }

  const scheduledForDeletionAt = normalizeTimestamp(
    lifecycle['scheduledForDeletionAt']
  );
  const purgeEligibleAt = scheduledForDeletionAt === null
    ? null
    : scheduledForDeletionAt + safeGraceDays * DAY_MS;

  if (hasCommunityLifecycleHold(community)) {
    return blocked(
      'lifecycle_hold',
      safeGraceDays,
      scheduledForDeletionAt,
      purgeEligibleAt
    );
  }

  const memberCount = normalizeMemberCount(metrics['memberCount']);
  if (memberCount === null) {
    return blocked(
      'member_count_unknown',
      safeGraceDays,
      scheduledForDeletionAt,
      purgeEligibleAt
    );
  }

  if (memberCount > 0) {
    return blocked(
      'members_present',
      safeGraceDays,
      scheduledForDeletionAt,
      purgeEligibleAt
    );
  }

  if (scheduledForDeletionAt === null || purgeEligibleAt === null) {
    return blocked('missing_schedule_anchor', safeGraceDays, null, null);
  }

  if (purgeEligibleAt > now) {
    return blocked(
      'grace_period',
      safeGraceDays,
      scheduledForDeletionAt,
      purgeEligibleAt
    );
  }

  if (context.hasBlockingModerationReference === true) {
    return blocked(
      'moderation_reference_hold',
      safeGraceDays,
      scheduledForDeletionAt,
      purgeEligibleAt
    );
  }

  return {
    eligible: true,
    reason: 'eligible',
    scheduledForDeletionAt,
    purgeEligibleAt,
    graceDays: safeGraceDays,
    policyVersion: COMMUNITY_PURGE_POLICY_VERSION,
  };
}
