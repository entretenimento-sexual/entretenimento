// src/app/community/data-access/community-member-management.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBER MANAGEMENT CLIENT CONTRACTS
// -----------------------------------------------------------------------------
// Respostas administrativas são normalizadas novamente no cliente. O browser
// recebe identidade pública mínima, vínculo e capabilities calculadas no backend.
// -----------------------------------------------------------------------------

export type CommunityManagedMemberListStatus = 'active' | 'blocked';
export type CommunityManagedMemberRole = 'owner' | 'admin' | 'moderator' | 'member';
export type CommunityAssignableMemberRole = 'admin' | 'moderator' | 'member';
export type CommunityMemberManagementAction =
  | 'set_role'
  | 'remove'
  | 'block'
  | 'unblock';

export interface CommunityManagedMemberCapabilities {
  assignableRoles: readonly CommunityAssignableMemberRole[];
  canRemove: boolean;
  canBlock: boolean;
  canUnblock: boolean;
}

export interface CommunityManagedMemberItem {
  memberId: string;
  label: string;
  avatarUrl: string | null;
  status: CommunityManagedMemberListStatus;
  role: CommunityManagedMemberRole;
  roleBeforeBlock: CommunityAssignableMemberRole | null;
  updatedAt: number;
  capabilities: CommunityManagedMemberCapabilities;
}

export interface CommunityManagedMembersPage {
  items: readonly CommunityManagedMemberItem[];
  nextCursor: string | null;
  generatedAt: number;
}

export interface CommunityManagedMembersPageRequest {
  communityId: string;
  status: CommunityManagedMemberListStatus;
  cursor?: string | null;
  limit?: number;
}

export interface CommunityManageMemberResponse {
  memberId: string;
  status: 'active' | 'blocked' | 'left';
  role: CommunityAssignableMemberRole;
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function normalizeText(value: unknown, maxLength: number): string {
  return String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeSafeId(value: unknown): string | null {
  const normalized = normalizeText(value, 128);
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function normalizeHttpsUrl(value: unknown): string | null {
  const normalized = normalizeText(value, 2_000);
  if (!normalized) return null;

  try {
    const parsed = new URL(normalized);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function normalizeEpoch(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeRole(value: unknown): CommunityManagedMemberRole | null {
  return value === 'owner'
    || value === 'admin'
    || value === 'moderator'
    || value === 'member'
    ? value
    : null;
}

function normalizeAssignableRole(value: unknown): CommunityAssignableMemberRole | null {
  return value === 'admin' || value === 'moderator' || value === 'member'
    ? value
    : null;
}

function normalizeCapabilities(
  raw: unknown
): CommunityManagedMemberCapabilities | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  if (!Array.isArray(source['assignableRoles'])) return null;

  const roles = new Set<CommunityAssignableMemberRole>();
  for (const rawRole of source['assignableRoles'].slice(0, 3)) {
    const role = normalizeAssignableRole(rawRole);
    if (role) roles.add(role);
  }

  return {
    assignableRoles: [...roles],
    canRemove: source['canRemove'] === true,
    canBlock: source['canBlock'] === true,
    canUnblock: source['canUnblock'] === true,
  };
}

export function normalizeCommunityManagedMembersPage(
  raw: unknown
): CommunityManagedMembersPage | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const generatedAt = normalizeEpoch(source['generatedAt']);
  const nextCursorRaw = source['nextCursor'];
  const nextCursor = nextCursorRaw == null ? null : normalizeSafeId(nextCursorRaw);

  if (
    !Array.isArray(source['items'])
    || !generatedAt
    || (nextCursorRaw != null && !nextCursor)
  ) {
    return null;
  }

  const items = source['items']
    .slice(0, 40)
    .map((rawItem): CommunityManagedMemberItem | null => {
      const item = (rawItem ?? {}) as Record<string, unknown>;
      const memberId = normalizeSafeId(item['memberId']);
      const label = normalizeText(item['label'], 60);
      const status = item['status'];
      const role = normalizeRole(item['role']);
      const roleBeforeBlock = item['roleBeforeBlock'] == null
        ? null
        : normalizeAssignableRole(item['roleBeforeBlock']);
      const updatedAt = normalizeEpoch(item['updatedAt']);
      const capabilities = normalizeCapabilities(item['capabilities']);

      if (
        !memberId
        || label.length < 2
        || (status !== 'active' && status !== 'blocked')
        || !role
        || !updatedAt
        || !capabilities
        || (item['roleBeforeBlock'] != null && !roleBeforeBlock)
      ) {
        return null;
      }

      return {
        memberId,
        label,
        avatarUrl: normalizeHttpsUrl(item['avatarUrl']),
        status,
        role,
        roleBeforeBlock,
        updatedAt,
        capabilities,
      };
    })
    .filter((item): item is CommunityManagedMemberItem => item !== null);

  return { items, nextCursor, generatedAt };
}

export function normalizeCommunityManageMemberResponse(
  raw: unknown
): CommunityManageMemberResponse | null {
  const source = (raw ?? {}) as Record<string, unknown>;
  const memberId = normalizeSafeId(source['memberId']);
  const status = source['status'];
  const role = normalizeAssignableRole(source['role']);
  const generatedAt = normalizeEpoch(source['generatedAt']);

  if (
    !memberId
    || (status !== 'active' && status !== 'blocked' && status !== 'left')
    || !role
    || !generatedAt
  ) {
    return null;
  }

  return { memberId, status, role, generatedAt };
}
