// functions/src/community/community-lifecycle.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY LIFECYCLE POLICY
// -----------------------------------------------------------------------------
// Decide o ciclo de vida de Comunidades comuns sem tocar em Locais.
// A política não apaga documentos: ela apenas produz transições seguras para
// dormant, archived ou scheduled_for_deletion. A exclusão física deve respeitar
// retenção, moderação, denúncias e eventual obrigação legal.
// -----------------------------------------------------------------------------

import { isCommunityLifecycleStatus } from './community-contract.generated';
import type {
  CommunityLifecycleStatus as CanonicalCommunityLifecycleStatus,
} from './community-contract.generated';

export type CommunityLifecycleStatus = CanonicalCommunityLifecycleStatus;

export type CommunityLifecycleReason =
  | 'not_community'
  | 'moderation_hold'
  | 'status_not_managed'
  | 'meaningful_activity_resumed'
  | 'owned_archive_recovered'
  | 'inactive'
  | 'empty_and_inactive'
  | 'empty_archive_expired'
  | 'orphaned_content_archive_expired'
  | 'no_transition';

export interface CommunityLifecycleThresholds {
  dormantAfterDays: number;
  archiveAfterDays: number;
  emptyArchiveAfterDays: number;
  emptyDeletionAfterDays: number;
  orphanedContentDeletionAfterDays: number;
}

export interface CommunityLifecycleDecision {
  currentStatus: CommunityLifecycleStatus;
  nextStatus: CommunityLifecycleStatus;
  changed: boolean;
  reason: CommunityLifecycleReason;
  shouldHideFromDiscovery: boolean;
  deletionEligibleAt: number | null;
}

export const DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS:
  Readonly<CommunityLifecycleThresholds> = Object.freeze({
    dormantAfterDays: 60,
    archiveAfterDays: 120,
    emptyArchiveAfterDays: 30,
    emptyDeletionAfterDays: 90,
    orphanedContentDeletionAfterDays: 365,
  });

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

function normalizeOptionalCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    ? Math.trunc(value)
    : null;
}

function normalizeStatus(value: unknown): CommunityLifecycleStatus {
  return isCommunityLifecycleStatus(value) ? value : 'active';
}

function hasOwnershipReference(value: unknown): boolean {
  return String(value ?? '').trim().length > 0;
}

/**
 * `dormant` sai da descoberta e não aceita novas adesões, mas membros já ativos
 * podem gerar atividade legítima para que o lifecycle volte a `active`.
 */
export function isCommunityMemberActivityEnabledStatus(value: unknown): boolean {
  return value === 'active' || value === 'dormant';
}

/** Gestão de vínculos permanece disponível em active/paused, nunca em dormant. */
export function isCommunityMembershipManagementEnabledStatus(value: unknown): boolean {
  return value === 'active' || value === 'paused';
}

export function hasCommunityLifecycleHold(rawCommunity: unknown): boolean {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const moderation = (community['moderation'] ?? {}) as Record<string, unknown>;
  const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;

  return moderation['state'] !== 'active'
    || moderation['retentionHold'] === true
    || moderation['legalHold'] === true
    || lifecycle['retentionHold'] === true
    || lifecycle['hold'] === true
    || community['legalHold'] === true;
}

function ageInDays(now: number, timestamp: number | null): number {
  if (!timestamp || timestamp > now) return 0;
  return (now - timestamp) / DAY_MS;
}

function noTransition(
  status: CommunityLifecycleStatus,
  reason: CommunityLifecycleReason,
  deletionEligibleAt: number | null = null
): CommunityLifecycleDecision {
  return {
    currentStatus: status,
    nextStatus: status,
    changed: false,
    reason,
    shouldHideFromDiscovery:
      status === 'dormant'
      || status === 'archived'
      || status === 'scheduled_for_deletion',
    deletionEligibleAt,
  };
}

function transition(
  currentStatus: CommunityLifecycleStatus,
  nextStatus: CommunityLifecycleStatus,
  reason: CommunityLifecycleReason,
  deletionEligibleAt: number | null = null
): CommunityLifecycleDecision {
  return {
    currentStatus,
    nextStatus,
    changed: currentStatus !== nextStatus,
    reason,
    shouldHideFromDiscovery:
      nextStatus === 'dormant'
      || nextStatus === 'archived'
      || nextStatus === 'scheduled_for_deletion',
    deletionEligibleAt,
  };
}

export function evaluateCommunityLifecycle(
  rawCommunity: unknown,
  now = Date.now(),
  thresholds: Readonly<CommunityLifecycleThresholds> =
    DEFAULT_COMMUNITY_LIFECYCLE_THRESHOLDS
): CommunityLifecycleDecision {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const source = (community['source'] ?? {}) as Record<string, unknown>;
  const lifecycle = (community['lifecycle'] ?? {}) as Record<string, unknown>;
  const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;
  const status = normalizeStatus(community['status']);

  if (source['type'] !== 'community') {
    return noTransition(status, 'not_community');
  }

  if (hasCommunityLifecycleHold(community)) {
    return noTransition(status, 'moderation_hold');
  }

  if (status === 'paused' || status === 'scheduled_for_deletion') {
    return noTransition(status, 'status_not_managed');
  }

  const memberCount = normalizeOptionalCount(metrics['memberCount']);
  const postCount = normalizeOptionalCount(metrics['postCount']);
  const mediaCount = normalizeOptionalCount(metrics['mediaCount']);
  const topicCount = normalizeOptionalCount(metrics['topicCount']);
  const contentMetricsComplete =
    postCount !== null && mediaCount !== null && topicCount !== null;
  const contentCount =
    (postCount ?? 0) + (mediaCount ?? 0) + (topicCount ?? 0);
  const hasRetainedContent = !contentMetricsComplete || contentCount > 0;
  const ownerReferencePresent = hasOwnershipReference(community['ownerUid']);
  const lastMeaningfulActivityAt =
    normalizeTimestamp(lifecycle['lastMeaningfulActivityAt'])
    ?? normalizeTimestamp(community['updatedAt'])
    ?? normalizeTimestamp(community['createdAt'])
    ?? now;
  const inactiveDays = ageInDays(now, lastMeaningfulActivityAt);
  const archivedAt = normalizeTimestamp(lifecycle['archivedAt']);
  const archivedDays = ageInDays(now, archivedAt ?? lastMeaningfulActivityAt);

  if (status === 'active') {
    /**
     * Arquivamento automático é terminal. Portanto só pode ocorrer quando não
     * existe mais ownership nem vínculo ativo conhecido. Comunidades pertencentes
     * a alguém entram primeiro em `dormant` e continuam recuperáveis por atividade.
     */
    if (
      !ownerReferencePresent
      && memberCount === 0
      && contentMetricsComplete
      && contentCount === 0
      && inactiveDays >= thresholds.emptyArchiveAfterDays
    ) {
      return transition(status, 'archived', 'empty_and_inactive');
    }

    if (inactiveDays >= thresholds.dormantAfterDays) {
      return transition(status, 'dormant', 'inactive');
    }

    return noTransition(status, 'no_transition');
  }

  if (status === 'dormant') {
    if (inactiveDays < thresholds.dormantAfterDays) {
      return transition(status, 'active', 'meaningful_activity_resumed');
    }

    /**
     * `dormant` é o estado recuperável. Nunca convertemos automaticamente uma
     * Comunidade ainda pertencente a alguém ou com membros conhecidos para o
     * estado terminal `archived`.
     */
    if (ownerReferencePresent || memberCount === null || memberCount > 0) {
      return noTransition(status, 'no_transition');
    }

    if (inactiveDays >= thresholds.archiveAfterDays) {
      return transition(status, 'archived', 'inactive');
    }

    return noTransition(status, 'no_transition');
  }

  /**
   * Versões anteriores do scheduler podiam produzir `archived` preservando
   * `ownerUid`. Esse estado não possui a mesma semântica do arquivamento manual.
   * Rebaixamos para `dormant`: permanece oculto, mas volta ao lifecycle recuperável.
   */
  if (status === 'archived' && ownerReferencePresent) {
    return transition(status, 'dormant', 'owned_archive_recovered');
  }

  // Ausência/corrupção da métrica de membros nunca pode ser interpretada como
  // zero para uma transição destrutiva. O Scheduler preserva o arquivo até que
  // o estado canônico seja conhecido.
  if (memberCount === null || memberCount > 0) {
    return noTransition(status, 'no_transition');
  }

  if (
    !hasRetainedContent
    && archivedDays >= thresholds.emptyDeletionAfterDays
  ) {
    return transition(
      status,
      'scheduled_for_deletion',
      'empty_archive_expired',
      now
    );
  }

  if (
    hasRetainedContent
    && archivedDays >= thresholds.orphanedContentDeletionAfterDays
  ) {
    return transition(
      status,
      'scheduled_for_deletion',
      'orphaned_content_archive_expired',
      now
    );
  }

  return noTransition(status, 'no_transition');
}
