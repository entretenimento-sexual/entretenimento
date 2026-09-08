// src/app/community/data-access/community-member-roster.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER ROSTER - CLIENT CONTRACT
// -----------------------------------------------------------------------------
// A listagem é uma projeção interna e mínima. Não aceita UID, nome civil, KYC,
// status de bloqueio ou capabilities administrativas. A paginação transporta
// somente o profileId público canônico; UID nunca é cursor do cliente.
// -----------------------------------------------------------------------------

import {
  normalizePublicProfileId,
} from 'src/app/core/domain/public-user-identity/public-profile-id.model';
import {
  normalizePublicUserIdentity,
  type PublicUserIdentity,
} from 'src/app/core/domain/public-user-identity/public-user-identity.model';

export type CommunityMemberRosterRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | 'member';

export interface CommunityMemberRosterItem {
  readonly memberKey: string;
  readonly identity: PublicUserIdentity;
  readonly role: CommunityMemberRosterRole;
}

export interface CommunityMemberRosterPage {
  readonly items: readonly CommunityMemberRosterItem[];
  readonly nextCursor: string | null;
  readonly memberCount: number;
  readonly generatedAt: number;
}

export interface CommunityMemberRosterPageRequest {
  readonly communityId: string;
  readonly cursor?: string | null;
  readonly limit?: number;
}

function normalizeCount(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : null;
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : null;
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
  return normalizePublicProfileId(value);
}

export function normalizeCommunityMemberRosterPage(
  raw: unknown
): CommunityMemberRosterPage | null {
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

  const byKey = new Map<string, CommunityMemberRosterItem>();

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
