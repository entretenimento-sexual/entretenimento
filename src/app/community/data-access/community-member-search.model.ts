// src/app/community/data-access/community-member-search.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER SEARCH - CLIENT CONTRACT
// -----------------------------------------------------------------------------
// Resultado mínimo e paginado da busca interna. UID nunca é exposto; memberKey
// e navegação usam exclusivamente o profileId público canônico.
// -----------------------------------------------------------------------------

import {
  normalizePublicProfileId,
} from 'src/app/core/domain/public-user-identity/public-profile-id.model';
import {
  normalizePublicUserIdentity,
  type PublicUserIdentity,
} from 'src/app/core/domain/public-user-identity/public-user-identity.model';
import type { CommunityMemberRosterRole } from './community-member-roster.model';

export interface CommunityMemberSearchItem {
  readonly memberKey: string;
  readonly identity: PublicUserIdentity;
  readonly role: CommunityMemberRosterRole;
}

export interface CommunityMemberSearchPage {
  readonly items: readonly CommunityMemberSearchItem[];
  readonly nextCursor: string | null;
  readonly memberCount: number;
  readonly generatedAt: number;
}

export interface CommunityMemberSearchPageRequest {
  readonly communityId: string;
  readonly query: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

const SEARCH_CURSOR_PATTERN = /^v1_[A-Za-z0-9_-]{1,700}$/;

function normalizeCount(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeRole(value: unknown): CommunityMemberRosterRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeCursor(value: unknown): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value).trim();
  return SEARCH_CURSOR_PATTERN.test(normalized) ? normalized : null;
}

export function normalizeCommunityMemberSearchPage(
  raw: unknown
): CommunityMemberSearchPage | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const memberCount = normalizeCount(source['memberCount']);
  const generatedAt = normalizeEpoch(source['generatedAt']);
  const nextCursorRaw = source['nextCursor'];
  const nextCursor = normalizeCursor(nextCursorRaw);

  if (
    !Array.isArray(source['items'])
    || memberCount === null
    || generatedAt === null
    || (nextCursorRaw != null && nextCursorRaw !== '' && !nextCursor)
  ) {
    return null;
  }

  const byKey = new Map<string, CommunityMemberSearchItem>();

  for (const rawItem of source['items'].slice(0, 40)) {
    const item = (rawItem ?? {}) as Record<string, unknown>;
    const memberKey = normalizePublicProfileId(item['memberKey']);
    const identity = normalizePublicUserIdentity(item['identity']);
    const role = normalizeRole(item['role']);

    if (
      !memberKey
      || !identity?.profileId
      || identity.profileId !== memberKey
      || !role
    ) {
      continue;
    }

    byKey.set(memberKey, { memberKey, identity, role });
  }

  return {
    items: [...byKey.values()],
    nextCursor,
    memberCount,
    generatedAt,
  };
}
