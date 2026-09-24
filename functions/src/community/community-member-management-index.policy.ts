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

export const COMMUNITY_MEMBER_MANAGEMENT_INDEX_VERSION = 1;
export const COMMUNITY_MEMBER_MANAGEMENT_MIN_SEARCH_LENGTH = 2;
export const COMMUNITY_MEMBER_MANAGEMENT_MAX_SEARCH_LENGTH = 40;
export const COMMUNITY_MEMBER_MANAGEMENT_MAX_SEARCH_PREFIXES = 64;

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

export interface CommunityMemberManagementIndexProjection
  extends CommunityMemberManagementSearchIdentity {
  readonly projectionVersion: number;
  readonly communityId: string;
  readonly memberId: string;
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
  return normalizeDisplayText(
    value,
    COMMUNITY_MEMBER_MANAGEMENT_MAX_SEARCH_LENGTH
  )
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCommunityMemberManagementSearchQuery(
  value: unknown
): string | null {
  const raw = normalizeDisplayText(
    value,
    COMMUNITY_MEMBER_MANAGEMENT_MAX_SEARCH_LENGTH
  );

  if (!raw) return '';

  const normalized = normalizeCommunityMemberManagementSearchText(raw);
  if (
    normalized.length < COMMUNITY_MEMBER_MANAGEMENT_MIN_SEARCH_LENGTH
    || normalized.length > COMMUNITY_MEMBER_MANAGEMENT_MAX_SEARCH_LENGTH
  ) {
    return null;
  }

  return normalized;
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

function buildPrefixes(value: string): string[] {
  if (value.length < COMMUNITY_MEMBER_MANAGEMENT_MIN_SEARCH_LENGTH) return [];

  const prefixes: string[] = [];
  const maxLength = Math.min(
    value.length,
    COMMUNITY_MEMBER_MANAGEMENT_MAX_SEARCH_LENGTH
  );

  for (
    let length = COMMUNITY_MEMBER_MANAGEMENT_MIN_SEARCH_LENGTH;
    length <= maxLength;
    length += 1
  ) {
    prefixes.push(value.slice(0, length));
  }

  return prefixes;
}

export function buildCommunityMemberManagementSearchPrefixes(
  label: string
): readonly string[] {
  const normalized = normalizeCommunityMemberManagementSearchText(label);
  if (!normalized) return [];

  const candidates = [
    ...buildPrefixes(normalized),
    ...normalized
      .split(' ')
      .filter(Boolean)
      .flatMap((token) => buildPrefixes(token)),
  ];

  return Array.from(new Set(candidates))
    .sort((left, right) => left.length - right.length || left.localeCompare(right))
    .slice(0, COMMUNITY_MEMBER_MANAGEMENT_MAX_SEARCH_PREFIXES);
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
    status,
    managementRole,
    leadership:
      managementRole === 'admin' || managementRole === 'moderator',
    ...buildCommunityMemberManagementSearchIdentity(input.rawUser),
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
