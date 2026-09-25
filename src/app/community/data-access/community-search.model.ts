// src/app/community/data-access/community-search.model.ts
import {
  normalizePublicUserIdentity,
  type PublicUserIdentity,
} from 'src/app/core/domain/public-user-identity/public-user-identity.model';
import {
  normalizeCommunityTopicPageResponse,
  type CommunityTopicListItem,
} from './community-topic.model';

export type CommunitySearchScope = 'members' | 'topics';
export type CommunitySearchMemberRole = 'owner' | 'admin' | 'moderator' | 'member';

export interface CommunitySearchMemberItem {
  readonly type: 'member';
  readonly memberKey: string;
  readonly identity: PublicUserIdentity;
  readonly role: CommunitySearchMemberRole;
}

export interface CommunitySearchTopicItem extends CommunityTopicListItem {
  readonly type: 'topic';
}

export type CommunitySearchItem =
  | CommunitySearchMemberItem
  | CommunitySearchTopicItem;

export interface CommunitySearchPage {
  readonly scope: CommunitySearchScope;
  readonly query: string;
  readonly available: boolean;
  readonly items: readonly CommunitySearchItem[];
  readonly nextCursor: string | null;
  readonly generatedAt: number;
}

export interface CommunitySearchPageRequest {
  readonly communityId: string;
  readonly query: string;
  readonly scope: CommunitySearchScope;
  readonly cursor?: string | null;
  readonly limit?: number;
}

const CURSOR_PATTERN = /^[A-Za-z0-9:_-]{1,512}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeScope(value: unknown): CommunitySearchScope | null {
  return value === 'members' || value === 'topics' ? value : null;
}

function normalizeRole(value: unknown): CommunitySearchMemberRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeCursor(value: unknown): string | null {
  if (value == null || value === '') return null;
  const normalized = normalizeText(value, 512);
  return CURSOR_PATTERN.test(normalized) ? normalized : null;
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeMemberItem(raw: unknown): CommunitySearchMemberItem | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (source['type'] !== 'member') return null;

  const memberKey = normalizeText(source['memberKey'], 128);
  const identity = normalizePublicUserIdentity(source['identity']);
  const role = normalizeRole(source['role']);

  if (
    !memberKey
    || !identity?.profileId
    || identity.profileId !== memberKey
    || !role
  ) {
    return null;
  }

  return { type: 'member', memberKey, identity, role };
}

export function normalizeCommunitySearchPage(
  raw: unknown
): CommunitySearchPage | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const scope = normalizeScope(source['scope']);
  const query = normalizeText(source['query'], 40);
  const generatedAt = normalizeEpoch(source['generatedAt']);
  const nextCursorRaw = source['nextCursor'];
  const nextCursor = normalizeCursor(nextCursorRaw);

  if (
    !scope
    || query.length < 2
    || !generatedAt
    || !Array.isArray(source['items'])
    || (nextCursorRaw != null && nextCursorRaw !== '' && !nextCursor)
  ) {
    return null;
  }

  const items: CommunitySearchItem[] = scope === 'members'
    ? source['items']
        .slice(0, 20)
        .map(normalizeMemberItem)
        .filter((item): item is CommunitySearchMemberItem => item !== null)
    : normalizeCommunityTopicPageResponse({
        items: source['items'],
        nextCursor: null,
        generatedAt,
      }).items.map((item) => ({ type: 'topic' as const, ...item }));

  return {
    scope,
    query,
    available: source['available'] === true,
    items,
    nextCursor,
    generatedAt,
  };
}
