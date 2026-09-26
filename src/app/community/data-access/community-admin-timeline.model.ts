// src/app/community/data-access/community-admin-timeline.model.ts
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
  | 'highlight_changed'
  | 'content_removed'
  | 'topic_moderated'
  | 'official_status_changed'
  | 'lifecycle_changed';

export type CommunityAdminTimelineRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | 'member';

export interface CommunityAdminTimelineIdentity {
  kind: 'user' | 'system';
  label: string;
}

export interface CommunityAdminTimelineDetails {
  previousRole?: CommunityAdminTimelineRole | null;
  nextRole?: CommunityAdminTimelineRole | null;
  changedFields?: readonly string[];
  target?: 'post' | 'comment' | 'reply' | 'topic';
  action?: 'locked' | 'unlocked' | 'removed' | 'pinned' | 'unpinned';
  previousStatus?: string | null;
  nextStatus?: string | null;
}

export interface CommunityAdminTimelineItem {
  id: string;
  category: CommunityAdminTimelineCategory;
  eventType: CommunityAdminTimelineEventType;
  actor: CommunityAdminTimelineIdentity;
  subject: CommunityAdminTimelineIdentity | null;
  details: CommunityAdminTimelineDetails;
  createdAt: number;
}

export interface CommunityAdminTimelinePage {
  items: readonly CommunityAdminTimelineItem[];
  nextCursor: string | null;
  generatedAt: number;
}

const CATEGORIES = new Set<CommunityAdminTimelineCategory>([
  'membership',
  'ownership',
  'settings',
  'moderation',
  'official',
  'lifecycle',
]);

const EVENT_TYPES = new Set<CommunityAdminTimelineEventType>([
  'member_role_changed',
  'member_blocked',
  'member_unblocked',
  'member_removed',
  'membership_approved',
  'membership_rejected',
  'ownership_transferred',
  'community_archived',
  'settings_changed',
  'highlight_changed',
  'content_removed',
  'topic_moderated',
  'official_status_changed',
  'lifecycle_changed',
]);

const ROLES = new Set<CommunityAdminTimelineRole>([
  'owner',
  'admin',
  'moderator',
  'member',
]);

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeIdentity(value: unknown): CommunityAdminTimelineIdentity | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  const kind = raw['kind'];
  const label = cleanText(raw['label'], 60);

  if ((kind !== 'user' && kind !== 'system') || !label) return null;
  return { kind, label };
}

function normalizeRole(value: unknown): CommunityAdminTimelineRole | null {
  return ROLES.has(value as CommunityAdminTimelineRole)
    ? value as CommunityAdminTimelineRole
    : null;
}

function normalizeDetails(value: unknown): CommunityAdminTimelineDetails {
  const raw = (value ?? {}) as Record<string, unknown>;
  const details: CommunityAdminTimelineDetails = {};

  if (raw['previousRole'] === null) {
    details.previousRole = null;
  } else {
    const previousRole = normalizeRole(raw['previousRole']);
    if (previousRole) details.previousRole = previousRole;
  }

  if (raw['nextRole'] === null) {
    details.nextRole = null;
  } else {
    const nextRole = normalizeRole(raw['nextRole']);
    if (nextRole) details.nextRole = nextRole;
  }

  if (Array.isArray(raw['changedFields'])) {
    details.changedFields = raw['changedFields']
      .map((item) => cleanText(item, 40))
      .filter(Boolean)
      .slice(0, 8);
  }

  if (
    raw['target'] === 'post'
    || raw['target'] === 'comment'
    || raw['target'] === 'reply'
    || raw['target'] === 'topic'
  ) {
    details.target = raw['target'];
  }

  if (
    raw['action'] === 'locked'
    || raw['action'] === 'unlocked'
    || raw['action'] === 'removed'
    || raw['action'] === 'pinned'
    || raw['action'] === 'unpinned'
  ) {
    details.action = raw['action'];
  }

  const previousStatus = cleanText(raw['previousStatus'], 48);
  const nextStatus = cleanText(raw['nextStatus'], 48);
  if (previousStatus) details.previousStatus = previousStatus;
  if (nextStatus) details.nextStatus = nextStatus;

  return details;
}

function normalizeItem(value: unknown): CommunityAdminTimelineItem | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  const id = cleanText(raw['id'], 128);
  const category = raw['category'] as CommunityAdminTimelineCategory;
  const eventType = raw['eventType'] as CommunityAdminTimelineEventType;
  const actor = normalizeIdentity(raw['actor']);
  const subject =
    raw['subject'] === null ? null : normalizeIdentity(raw['subject']);
  const createdAt = Math.trunc(Number(raw['createdAt']));

  if (
    !id
    || !CATEGORIES.has(category)
    || !EVENT_TYPES.has(eventType)
    || !actor
    || (raw['subject'] !== null && !subject)
    || !Number.isFinite(createdAt)
    || createdAt <= 0
  ) {
    return null;
  }

  return {
    id,
    category,
    eventType,
    actor,
    subject,
    details: normalizeDetails(raw['details']),
    createdAt,
  };
}

export function normalizeCommunityAdminTimelinePage(
  value: unknown
): CommunityAdminTimelinePage | null {
  const raw = (value ?? {}) as Record<string, unknown>;
  if (!Array.isArray(raw['items'])) return null;

  const items = raw['items'].map(normalizeItem);
  if (items.some((item) => item === null)) return null;

  const nextCursorRaw = raw['nextCursor'];
  const nextCursor =
    nextCursorRaw === null ? null : cleanText(nextCursorRaw, 512);
  const generatedAt = Math.trunc(Number(raw['generatedAt']));

  if (
    (nextCursorRaw !== null && !nextCursor)
    || !Number.isFinite(generatedAt)
    || generatedAt <= 0
  ) {
    return null;
  }

  return {
    items: items as CommunityAdminTimelineItem[],
    nextCursor,
    generatedAt,
  };
}
