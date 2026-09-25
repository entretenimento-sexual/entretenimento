// functions/src/community/community-admin-timeline.projection.ts
// -----------------------------------------------------------------------------
// COMMUNITY ADMIN TIMELINE PROJECTION
// -----------------------------------------------------------------------------
// Converte auditoria operacional bruta em um contrato mínimo e seguro.
// Razões, evidências, IDs de conteúdo e payloads internos nunca entram aqui.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

export type CommunityAdminTimelineSource =
  | 'membership'
  | 'settings'
  | 'feed'
  | 'topic'
  | 'official'
  | 'lifecycle';

export type CommunityAdminTimelineCategory =
  | 'membership'
  | 'ownership'
  | 'settings'
  | 'moderation'
  | 'official'
  | 'lifecycle';

export type CommunityAdminTimelineEventType =
  | 'member_role_changed'
  | 'member_blocked'
  | 'member_unblocked'
  | 'member_removed'
  | 'membership_approved'
  | 'membership_rejected'
  | 'ownership_transferred'
  | 'community_archived'
  | 'settings_changed'
  | 'content_removed'
  | 'topic_moderated'
  | 'official_status_changed'
  | 'lifecycle_changed';

export type CommunityAdminTimelineRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | 'member';

export interface CommunityAdminTimelineDetails {
  previousRole?: CommunityAdminTimelineRole | null;
  nextRole?: CommunityAdminTimelineRole | null;
  changedFields?: readonly string[];
  target?: 'post' | 'comment' | 'reply' | 'topic';
  action?: 'locked' | 'unlocked' | 'removed';
  previousStatus?: string | null;
  nextStatus?: string | null;
}

export interface CommunityAdminTimelineProjection {
  version: 1;
  source: CommunityAdminTimelineSource;
  sourceAuditId: string;
  communityId: string;
  category: CommunityAdminTimelineCategory;
  eventType: CommunityAdminTimelineEventType;
  actorKind: 'user' | 'system';
  actorUid: string | null;
  subjectUid: string | null;
  details: CommunityAdminTimelineDetails;
  createdAtMs: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_STATUS_PATTERN = /^[a-z0-9_-]{1,48}$/;
const SAFE_SETTINGS_FIELDS = new Set([
  'name',
  'description',
  'rules',
  'joinPolicy',
  'membersCanInvite',
  'memberLimit',
  'tagIds',
]);

function safeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function role(value: unknown): CommunityAdminTimelineRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function status(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_STATUS_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeCommunityAdminTimelineCreatedAt(
  value: unknown
): number | null {
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) && millis > 0 ? Math.trunc(millis) : null;
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

function changedFields(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];

  return [...new Set(
    value
      .map((item) => String(item ?? '').trim())
      .filter((item) => SAFE_SETTINGS_FIELDS.has(item))
  )].slice(0, SAFE_SETTINGS_FIELDS.size);
}

function baseProjection(
  source: CommunityAdminTimelineSource,
  auditId: string,
  raw: Record<string, unknown>
): Pick<
  CommunityAdminTimelineProjection,
  'version' | 'source' | 'sourceAuditId' | 'communityId' | 'createdAtMs'
> | null {
  const communityId = safeId(raw['communityId']);
  const createdAtMs = normalizeCommunityAdminTimelineCreatedAt(raw['createdAt']);
  const sourceAuditId = String(auditId ?? '').trim();

  if (!communityId || !createdAtMs || !sourceAuditId) return null;

  return {
    version: 1,
    source,
    sourceAuditId,
    communityId,
    createdAtMs,
  };
}

function actor(
  raw: Record<string, unknown>
): Pick<CommunityAdminTimelineProjection, 'actorKind' | 'actorUid'> {
  const actorUid = safeId(raw['actorUid']);
  if (!actorUid || actorUid === 'system') {
    return { actorKind: 'system', actorUid: null };
  }
  return { actorKind: 'user', actorUid };
}

function membershipProjection(
  auditId: string,
  raw: Record<string, unknown>
): CommunityAdminTimelineProjection | null {
  const base = baseProjection('membership', auditId, raw);
  if (!base) return null;

  const action = String(raw['action'] ?? '').trim();
  const actorData = actor(raw);
  const subjectUid = safeId(raw['subjectUid']);
  const previousRole = role(raw['previousRole']);
  const nextRole = role(raw['nextRole'] ?? raw['role']);

  if (
    action === 'community-member-role-changed'
    && actorData.actorUid
    && subjectUid
  ) {
    return {
      ...base,
      ...actorData,
      category: 'membership',
      eventType: 'member_role_changed',
      subjectUid,
      details: { previousRole, nextRole },
    };
  }

  const simpleEvent: Readonly<Record<string, CommunityAdminTimelineEventType>> = {
    'community-member-blocked': 'member_blocked',
    'community-member-unblocked': 'member_unblocked',
    'community-member-removed': 'member_removed',
    'community-membership-approved': 'membership_approved',
    'community-membership-rejected': 'membership_rejected',
  };
  const eventType = simpleEvent[action];

  if (eventType && actorData.actorUid && subjectUid) {
    return {
      ...base,
      ...actorData,
      category: 'membership',
      eventType,
      subjectUid,
      details: {},
    };
  }

  if (
    action === 'community_ownership_transferred'
    && actorData.actorUid
    && subjectUid
  ) {
    return {
      ...base,
      ...actorData,
      category: 'ownership',
      eventType: 'ownership_transferred',
      subjectUid,
      details: { previousRole, nextRole: 'owner' },
    };
  }

  if (action === 'community_archived' && actorData.actorUid) {
    return {
      ...base,
      ...actorData,
      category: 'ownership',
      eventType: 'community_archived',
      subjectUid: null,
      details: {},
    };
  }

  return null;
}

function settingsProjection(
  auditId: string,
  raw: Record<string, unknown>
): CommunityAdminTimelineProjection | null {
  const base = baseProjection('settings', auditId, raw);
  const actorData = actor(raw);
  const safeFields = changedFields(raw['changedFields']);

  if (
    !base
    || String(raw['action'] ?? '') !== 'community_settings_updated'
    || !actorData.actorUid
    || safeFields.length === 0
  ) {
    return null;
  }

  return {
    ...base,
    ...actorData,
    category: 'settings',
    eventType: 'settings_changed',
    subjectUid: null,
    details: { changedFields: safeFields },
  };
}

function feedProjection(
  auditId: string,
  raw: Record<string, unknown>
): CommunityAdminTimelineProjection | null {
  const base = baseProjection('feed', auditId, raw);
  const actorData = actor(raw);
  const action = String(raw['action'] ?? '');

  if (!base || !actorData.actorUid) return null;

  const target =
    action === 'community-feed-post-removed-by-management'
      ? 'post'
      : action === 'community-feed-comment-removed-by-management'
        ? 'comment'
        : action === 'community-feed-comment-reply-removed-by-management'
          ? 'reply'
          : null;

  if (!target) return null;

  return {
    ...base,
    ...actorData,
    category: 'moderation',
    eventType: 'content_removed',
    subjectUid: null,
    details: { target },
  };
}

function topicProjection(
  auditId: string,
  raw: Record<string, unknown>
): CommunityAdminTimelineProjection | null {
  const base = baseProjection('topic', auditId, raw);
  const actorData = actor(raw);
  const rawAction = String(raw['action'] ?? '');

  if (!base || !actorData.actorUid) return null;

  const action =
    rawAction === 'community-topic-locked'
      ? 'locked'
      : rawAction === 'community-topic-unlocked'
        ? 'unlocked'
        : rawAction === 'community-topic-removed'
          ? 'removed'
          : null;

  if (!action) return null;

  return {
    ...base,
    ...actorData,
    category: 'moderation',
    eventType: 'topic_moderated',
    subjectUid: null,
    details: { target: 'topic', action },
  };
}

function officialProjection(
  auditId: string,
  raw: Record<string, unknown>
): CommunityAdminTimelineProjection | null {
  const base = baseProjection('official', auditId, raw);
  const action = String(raw['action'] ?? '');
  const previousStatus = status(raw['previousStatus']);
  const nextStatus = status(raw['nextStatus']);

  if (!base || !action.startsWith('official_claim_') || !nextStatus) {
    return null;
  }

  // Identidade de revisores internos da plataforma não é exposta à gestão.
  return {
    ...base,
    actorKind: 'system',
    actorUid: null,
    category: 'official',
    eventType: 'official_status_changed',
    subjectUid: null,
    details: { previousStatus, nextStatus },
  };
}

function lifecycleProjection(
  auditId: string,
  raw: Record<string, unknown>
): CommunityAdminTimelineProjection | null {
  const base = baseProjection('lifecycle', auditId, raw);
  const previousStatus = status(raw['previousStatus']);
  const nextStatus = status(raw['nextStatus']);

  if (
    !base
    || String(raw['action'] ?? '') !== 'community_lifecycle_transition'
    || !previousStatus
    || !nextStatus
  ) {
    return null;
  }

  return {
    ...base,
    actorKind: 'system',
    actorUid: null,
    category: 'lifecycle',
    eventType: 'lifecycle_changed',
    subjectUid: null,
    details: { previousStatus, nextStatus },
  };
}

export function buildCommunityAdminTimelineProjection(input: {
  source: CommunityAdminTimelineSource;
  auditId: string;
  rawAudit: unknown;
}): CommunityAdminTimelineProjection | null {
  const raw = (input.rawAudit ?? {}) as Record<string, unknown>;

  if (input.source === 'membership') {
    return membershipProjection(input.auditId, raw);
  }
  if (input.source === 'settings') {
    return settingsProjection(input.auditId, raw);
  }
  if (input.source === 'feed') {
    return feedProjection(input.auditId, raw);
  }
  if (input.source === 'topic') {
    return topicProjection(input.auditId, raw);
  }
  if (input.source === 'official') {
    return officialProjection(input.auditId, raw);
  }
  return lifecycleProjection(input.auditId, raw);
}

export function buildCommunityAdminTimelineProjectionId(
  source: CommunityAdminTimelineSource,
  auditId: string
): string {
  const digest = createHash('sha256')
    .update(`${source}:${String(auditId ?? '')}`)
    .digest('hex');

  return `v1_${source}_${digest.slice(0, 40)}`;
}
