// functions/src/community/community-member-management-index.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER MANAGEMENT INDEX
// -----------------------------------------------------------------------------
// Projeção privada e backend-only para tornar gestão e sucessão operáveis em
// Comunidades grandes. Nunca é fonte de autorização: handlers revalidam a
// membership canônica e, quando necessário, elegibilidade da conta.
//
// A busca é prefixada e normalizada no servidor. Nenhum dado de KYC, e-mail,
// idade, nome civil adicional ou capability administrativa é persistido aqui.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import {
  COMMUNITY_SEARCH_MAX_PREFIXES,
  COMMUNITY_SEARCH_MAX_QUERY_LENGTH,
  COMMUNITY_SEARCH_MIN_QUERY_LENGTH,
  buildCommunitySearchPrefixes,
  normalizeCommunitySearchQuery,
  normalizeCommunitySearchText,
} from './community-search-text.policy';

export const COMMUNITY_MEMBER_MANAGEMENT_INDEX_VERSION = 2;
export const COMMUNITY_MEMBER_MANAGEMENT_MIN_SEARCH_LENGTH =
  COMMUNITY_SEARCH_MIN_QUERY_LENGTH;
export const COMMUNITY_MEMBER_MANAGEMENT_MAX_SEARCH_LENGTH =
  COMMUNITY_SEARCH_MAX_QUERY_LENGTH;
export const COMMUNITY_MEMBER_MANAGEMENT_MAX_SEARCH_PREFIXES =
  COMMUNITY_SEARCH_MAX_PREFIXES;

export type CommunityMemberManagementIndexStatus = 'active' | 'blocked';
export type CommunityMemberManagementIndexRole =
  | 'owner'
  | 'admin'
  | 'moderator'
  | 'member';

export type CommunityMemberManagementRoleFilter =
  | 'all'
  | 'leadership'
  | CommunityMemberManagementIndexRole;

export interface CommunityMemberManagementSearchIdentity {
  readonly label: string;
  readonly avatarUrl: string | null;
  readonly sortLabel: string;
  readonly searchPrefixes: readonly string[];
}

export interface CommunityMemberPublicSearchIdentity {
  readonly publicSearchSortLabel: string;
  readonly publicSearchPrefixes: readonly string[];
}

export interface CommunityMemberManagementIndexProjection
  extends CommunityMemberManagementSearchIdentity,
    CommunityMemberPublicSearchIdentity {
  readonly projectionVersion: number;
  readonly communityId: string;
  readonly memberId: string;
  readonly searchKey: string;
  readonly status: CommunityMemberManagementIndexStatus;
  readonly managementRole: CommunityMemberManagementIndexRole;
  readonly leadership: boolean;
}

export interface CommunityMemberManagementCursorPosition {
  readonly sortLabel: string;
  readonly documentId: string;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const OPAQUE_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,512}$/;

function normalizeSafeId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeRole(value: unknown): CommunityMemberManagementIndexRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeStatus(value: unknown): CommunityMemberManagementIndexStatus | null {
  return value === 'active' || value === 'blocked' ? value : null;
}

function normalizeDisplayText(value: unknown, maxLength: number): string {
  return Array.from(String(value ?? ''), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f ? ' ' : character;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function normalizeCommunityMemberManagementSearchText(
  value: unknown
): string {
  return normalizeCommunitySearchText(value);
}

export function normalizeCommunityMemberManagementSearchQuery(
  value: unknown
): string | null {
  return normalizeCommunitySearchQuery(value);
}

export function normalizeCommunityMemberManagementRoleFilter(
  value: unknown
): CommunityMemberManagementRoleFilter | null {
  if (value === undefined || value === null || value === '') return 'all';

  return value === 'all'
    || value === 'leadership'
    || value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeDisplayText(value, 2_000);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export function buildCommunityMemberManagementSearchPrefixes(
  label: string
): readonly string[] {
  return buildCommunitySearchPrefixes(label);
}

export function buildCommunityMemberManagementSearchKey(
  communityId: string,
  memberId: string
): string {
  return createHash('sha256')
    .update(`${communityId}\0${memberId}`, 'utf8')
    .digest('hex');
}

export function buildCommunityMemberPublicSearchIdentity(
  rawPublicProfile: unknown
): CommunityMemberPublicSearchIdentity {
  const profile = (rawPublicProfile ?? {}) as Record<string, unknown>;
  const nickname = normalizeDisplayText(profile['nickname'], 60);
  const publicSearchSortLabel = nickname.length >= 2
    ? normalizeCommunitySearchText(nickname)
    : '';

  return {
    publicSearchSortLabel,
    publicSearchPrefixes: publicSearchSortLabel
      ? buildCommunitySearchPrefixes(nickname)
      : [],
  };
}

export function communityMemberPublicSearchIdentityEquals(
  left: CommunityMemberPublicSearchIdentity,
  right: CommunityMemberPublicSearchIdentity
): boolean {
  return left.publicSearchSortLabel === right.publicSearchSortLabel
    && left.publicSearchPrefixes.length === right.publicSearchPrefixes.length
    && left.publicSearchPrefixes.every(
      (value, index) => value === right.publicSearchPrefixes[index]
    );
}

export function communityMemberManagementSearchIdentityEquals(
  left: CommunityMemberManagementSearchIdentity,
  right: CommunityMemberManagementSearchIdentity
): boolean {
  return left.label === right.label
    && left.avatarUrl === right.avatarUrl
    && left.sortLabel === right.sortLabel
    && left.searchPrefixes.length === right.searchPrefixes.length
    && left.searchPrefixes.every(
      (value, index) => value === right.searchPrefixes[index]
    );
}

export function buildCommunityMemberManagementSearchIdentity(
  rawUser: unknown
): CommunityMemberManagementSearchIdentity {
  const user = (rawUser ?? {}) as Record<string, unknown>;
  const label =
    normalizeDisplayText(user['nickname'], 60)
    || normalizeDisplayText(user['nome'], 60)
    || 'Participante';
  const sortLabel =
    normalizeCommunityMemberManagementSearchText(label)
    || 'participante';

  return {
    label,
    avatarUrl: normalizeHttpsUrl(user['avatarUrl'] ?? user['photoURL']),
    sortLabel,
    searchPrefixes: buildCommunityMemberManagementSearchPrefixes(label),
  };
}

function resolveManagementRole(
  membership: Record<string, unknown>,
  status: CommunityMemberManagementIndexStatus
): CommunityMemberManagementIndexRole | null {
  const currentRole = normalizeRole(membership['role']);
  if (status !== 'blocked') return currentRole;

  const previousRole = normalizeRole(membership['blockedPreviousRole']);
  return previousRole ?? currentRole;
}

export function buildCommunityMemberManagementIndexProjection(input: {
  readonly communityId: unknown;
  readonly memberId: unknown;
  readonly rawMembership: unknown;
  readonly rawUser: unknown;
  readonly rawPublicProfile?: unknown;
}): CommunityMemberManagementIndexProjection | null {
  const communityId = normalizeSafeId(input.communityId);
  const memberId = normalizeSafeId(input.memberId);
  const membership = (input.rawMembership ?? {}) as Record<string, unknown>;
  const status = normalizeStatus(membership['status']);

  if (!communityId || !memberId || !status) return null;

  const managementRole = resolveManagementRole(membership, status);
  if (!managementRole) return null;

  return {
    projectionVersion: COMMUNITY_MEMBER_MANAGEMENT_INDEX_VERSION,
    communityId,
    memberId,
    searchKey: buildCommunityMemberManagementSearchKey(communityId, memberId),
    status,
    managementRole,
    leadership:
      managementRole === 'admin' || managementRole === 'moderator',
    ...buildCommunityMemberManagementSearchIdentity(input.rawUser),
    ...buildCommunityMemberPublicSearchIdentity(input.rawPublicProfile),
  };
}

export function communityMemberManagementProjectionId(
  communityId: string,
  memberId: string
): string {
  return `${communityId}:${memberId}`;
}

export function matchesCommunityMemberManagementRoleFilter(
  role: CommunityMemberManagementIndexRole,
  filter: CommunityMemberManagementRoleFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'leadership') {
    return role === 'admin' || role === 'moderator';
  }
  return role === filter;
}

export function normalizeCommunityMemberManagementCursorToken(
  value: unknown
): string | null {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  return OPAQUE_CURSOR_PATTERN.test(normalized) ? normalized : null;
}

export function encodeCommunityMemberManagementCursor(
  position: CommunityMemberManagementCursorPosition
): string {
  const payload = JSON.stringify({
    s: position.sortLabel.slice(0, 80),
    d: position.documentId.slice(0, 300),
  });

  return `v1_${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

export function decodeCommunityMemberManagementCursor(
  token: string
): CommunityMemberManagementCursorPosition | null {
  if (!token.startsWith('v1_')) return null;

  try {
    const parsed = JSON.parse(
      Buffer.from(token.slice(3), 'base64url').toString('utf8')
    ) as Record<string, unknown>;
    const sortLabel = normalizeCommunityMemberManagementSearchText(parsed['s']);
    const documentId = String(parsed['d'] ?? '').trim();

    if (!sortLabel || !documentId || documentId.length > 300) return null;

    return { sortLabel, documentId };
  } catch {
    return null;
  }
}
