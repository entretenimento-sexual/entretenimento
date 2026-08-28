// functions/src/community/community-purge.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY PURGE READINESS POLICY
// -----------------------------------------------------------------------------
// Decide se uma Comunidade já pode entrar em um futuro executor de exclusão
// física. Esta política não executa I/O nem apaga dados.
//
// O purge automático é deliberadamente fail closed: a ausência de uma prova
// canônica sobre memberships, conteúdo ou evidência de moderação bloqueia a
// exclusão. Auditorias históricas devem ser preservadas por qualquer executor.
// -----------------------------------------------------------------------------

import { hasCommunityLifecycleHold } from './community-lifecycle.policy';

export interface CommunityPurgeEvidenceProbe {
  hasLiveMemberships: boolean | null;
  hasRetainedContent: boolean | null;
  hasModerationEvidence: boolean | null;
}

export type CommunityPurgeDenialReason =
  | 'not_community'
  | 'not_scheduled_for_deletion'
  | 'retention_hold'
  | 'ownership_not_released'
  | 'member_count_unknown'
  | 'members_present'
  | 'membership_probe_unknown'
  | 'live_memberships_present'
  | 'content_probe_unknown'
  | 'retained_content_present'
  | 'moderation_evidence_probe_unknown'
  | 'moderation_evidence_present'
  | 'scheduled_at_unknown'
  | 'grace_period_not_elapsed';

export interface CommunityPurgeReadinessDecision {
  eligible: boolean;
  denialReason: CommunityPurgeDenialReason | null;
  purgeEligibleAt: number | null;
}

export const DEFAULT_COMMUNITY_PURGE_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1_000;

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

function normalizeMemberCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? Math.trunc(value)
    : null;
}

function normalizeGraceDays(value: unknown): number {
  const parsed = Math.trunc(Number(value));

  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 7), 365)
    : DEFAULT_COMMUNITY_PURGE_GRACE_DAYS;
}

function denied(
  denialReason: CommunityPurgeDenialReason,
  purgeEligibleAt: number | null = null
): CommunityPurgeReadinessDecision {
  return { eligible: false, denialReason, purgeEligibleAt };
}

export function resolveCommunityPurgeGraceDays(rawConfig: unknown): number {
  const config = (rawConfig ?? {}) as Record<string, unknown>;
  return normalizeGraceDays(config['lifecyclePurgeGraceDays']);
}

export function evaluateCommunityPurgeReadiness(
  rawCommunity: unknown,
  evidence: Readonly<CommunityPurgeEvidenceProbe>,
  now = Date.now(),
  graceDays = DEFAULT_COMMUNITY_PURGE_GRACE_DAYS
): CommunityPurgeReadinessDecision {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;
  const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;
  const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;

  if (source['type'] !== 'community') {
    return denied('not_community');
  }

  if (community['status'] !== 'scheduled_for_deletion') {
    return denied('not_scheduled_for_deletion');
  }

  if (hasCommunityLifecycleHold(community)) {
    return denied('retention_hold');
  }

  const ownerUid = String(community['ownerUid'] ?? '').trim();
  if (ownerUid) {
    return denied('ownership_not_released');
  }

  const memberCount = normalizeMemberCount(metrics['memberCount']);
  if (memberCount === null) {
    return denied('member_count_unknown');
  }
  if (memberCount > 0) {
    return denied('members_present');
  }

  if (evidence.hasLiveMemberships === null) {
    return denied('membership_probe_unknown');
  }
  if (evidence.hasLiveMemberships) {
    return denied('live_memberships_present');
  }

  if (evidence.hasRetainedContent === null) {
    return denied('content_probe_unknown');
  }
  if (evidence.hasRetainedContent) {
    return denied('retained_content_present');
  }

  if (evidence.hasModerationEvidence === null) {
    return denied('moderation_evidence_probe_unknown');
  }
  if (evidence.hasModerationEvidence) {
    return denied('moderation_evidence_present');
  }

  const scheduledAt = normalizeTimestamp(lifecycle['scheduledForDeletionAt']);
  if (!scheduledAt) {
    return denied('scheduled_at_unknown');
  }

  const normalizedGraceDays = normalizeGraceDays(graceDays);
  const purgeEligibleAt = scheduledAt + normalizedGraceDays * DAY_MS;

  if (!Number.isFinite(now) || now < purgeEligibleAt) {
    return denied('grace_period_not_elapsed', purgeEligibleAt);
  }

  return {
    eligible: true,
    denialReason: null,
    purgeEligibleAt,
  };
}
