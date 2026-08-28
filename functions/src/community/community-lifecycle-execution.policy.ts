// functions/src/community/community-lifecycle-execution.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY LIFECYCLE EXECUTION POLICY
// -----------------------------------------------------------------------------
// Traduz decisões puras de lifecycle em mutações backend-only e resolve limites
// configuráveis. Não executa I/O e não apaga documentos.
// -----------------------------------------------------------------------------

import {
  CommunityLifecycleDecision,
  CommunityLifecycleThresholds,
  DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS,
} from './community-lifecycle.policy';

export interface CommunityLifecycleMutationPlan {
  communityPatch: Record<string, unknown>;
  discoveryPatch: Record<string, unknown>;
  auditAction: 'community_lifecycle_transition';
}

export interface CommunityArchiveRetentionAnchorPlan {
  communityPatch: Record<string, unknown>;
  auditAction: 'community_lifecycle_retention_anchor_backfilled';
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
      const time = Number(source.toMillis());
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }

    const seconds = Number(source.seconds);
    const nanoseconds = Number(source.nanoseconds ?? 0);

    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      const time = seconds * 1_000 + Math.trunc(nanoseconds / 1_000_000);
      return Number.isFinite(time) && time > 0 ? Math.trunc(time) : null;
    }
  }

  return null;
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

export function resolveCommunityLifecycleThresholds(
  rawConfig: unknown
): CommunityLifecycleThresholds {
  const config = (rawConfig ?? {}) as Record<string, unknown>;
  const dormantAfterDays = normalizeInteger(
    config['lifecycleDormantAfterDays'],
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.dormantAfterDays,
    7,
    365
  );
  const archiveAfterDays = normalizeInteger(
    config['lifecycleArchiveAfterDays'],
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.archiveAfterDays,
    dormantAfterDays,
    730
  );
  const emptyArchiveAfterDays = normalizeInteger(
    config['lifecycleEmptyArchiveAfterDays'],
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyArchiveAfterDays,
    7,
    365
  );
  const emptyDeletionAfterDays = normalizeInteger(
    config['lifecycleEmptyDeletionAfterDays'],
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.emptyDeletionAfterDays,
    emptyArchiveAfterDays,
    1_095
  );
  const orphanedContentDeletionAfterDays = normalizeInteger(
    config['lifecycleOrphanedContentDeletionAfterDays'],
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS.orphanedContentDeletionAfterDays,
    emptyDeletionAfterDays,
    3_650
  );

  return {
    dormantAfterDays,
    archiveAfterDays,
    emptyArchiveAfterDays,
    emptyDeletionAfterDays,
    orphanedContentDeletionAfterDays,
  };
}

export function resolveCommunityLifecycleMaxPerRun(rawConfig: unknown): number {
  const config = (rawConfig ?? {}) as Record<string, unknown>;

  return normalizeInteger(
    config['lifecycleMaxCommunitiesPerRun'],
    500,
    50,
    5_000
  );
}

export function buildCommunityArchiveRetentionAnchorPlan(
  rawCommunity: unknown,
  now: number
): CommunityArchiveRetentionAnchorPlan | null {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;
  const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;

  if (
    source['type'] !== 'community'
    || community['status'] !== 'archived'
    || normalizeTimestamp(lifecycle['archivedAt']) !== null
  ) {
    return null;
  }

  const lastMeaningfulActivityAt =
    normalizeTimestamp(lifecycle['lastMeaningfulActivityAt'])
    ?? normalizeTimestamp(community['updatedAt'])
    ?? normalizeTimestamp(community['createdAt'])
    ?? now;
  const archivedAt = normalizeTimestamp(community['archivedAt']) ?? now;

  return {
    communityPatch: {
      'lifecycle.lastMeaningfulActivityAt': lastMeaningfulActivityAt,
      'lifecycle.archivedAt': archivedAt,
      'lifecycle.policyVersion': 1,
      updatedAt: now,
    },
    auditAction: 'community_lifecycle_retention_anchor_backfilled',
  };
}

export function buildCommunityLifecycleMutationPlan(
  rawCommunity: unknown,
  decision: Readonly<CommunityLifecycleDecision>,
  now: number
): CommunityLifecycleMutationPlan | null {
  if (!decision.changed) return null;

  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
  const visibility = community['visibility'] === 'members_only'
    ? 'members_only'
    : 'public_preview';
  const lastMeaningfulActivityAt =
    normalizeTimestamp(lifecycle['lastMeaningfulActivityAt'])
    ?? normalizeTimestamp(community['updatedAt'])
    ?? normalizeTimestamp(community['createdAt'])
    ?? now;
  const communityPatch: Record<string, unknown> = {
    status: decision.nextStatus,
    'lifecycle.lastMeaningfulActivityAt': lastMeaningfulActivityAt,
    'lifecycle.policyVersion': 1,
    updatedAt: now,
  };

  if (decision.nextStatus === 'active') {
    communityPatch['lifecycle.dormantAt'] = null;
    communityPatch['lifecycle.archivedAt'] = null;
    communityPatch['lifecycle.scheduledForDeletionAt'] = null;
  } else if (decision.nextStatus === 'dormant') {
    communityPatch['lifecycle.dormantAt'] =
      normalizeTimestamp(lifecycle['dormantAt']) ?? now;
    communityPatch['lifecycle.archivedAt'] = null;
    communityPatch['lifecycle.scheduledForDeletionAt'] = null;
  } else if (decision.nextStatus === 'archived') {
    const archivedAt = normalizeTimestamp(lifecycle['archivedAt']) ?? now;
    communityPatch['archivedAt'] = archivedAt;
    communityPatch['lifecycle.archivedAt'] = archivedAt;
    communityPatch['lifecycle.scheduledForDeletionAt'] = null;
  } else if (decision.nextStatus === 'scheduled_for_deletion') {
    communityPatch['lifecycle.scheduledForDeletionAt'] =
      decision.deletionEligibleAt ?? now;
  }

  const discoveryPatch: Record<string, unknown> = {
    status: decision.nextStatus,
    moderationState: moderation['state'] === 'active' ? 'active' : 'hidden',
    visibility,
    updatedAt: now,
  };

  if (decision.nextStatus === 'active') {
    discoveryPatch['rankScore'] = now;
  }

  return {
    communityPatch,
    discoveryPatch,
    auditAction: 'community_lifecycle_transition',
  };
}
