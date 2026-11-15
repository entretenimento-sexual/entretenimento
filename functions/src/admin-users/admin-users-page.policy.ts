export interface AdminUserRow {
  uid: string;
  nickname: string | null;
  profileCompleted: boolean;
  accountStatus: string;
  suspended: boolean;
  accountLocked: boolean;
  interactionBlocked: boolean;
  loginAllowed: boolean;
}

export interface AdminUsersPageRequest {
  cursor: string | null;
  limit: number;
}

export interface AdminUsersPageResponse {
  items: AdminUserRow[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface AdminUserDocument {
  id: string;
  data: Record<string, unknown>;
}

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PAGE_SIZE = 50;

export function parseAdminUsersPageRequest(
  value: unknown
): AdminUsersPageRequest | null {
  if (value == null) {
    return { cursor: null, limit: 25 };
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const input = value as Record<string, unknown>;

  if (Object.keys(input).some(
    key => key !== 'cursor' && key !== 'limit'
  )) {
    return null;
  }

  const rawLimit = input['limit'];
  const limit = rawLimit == null ? 25 : rawLimit;

  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE
  ) {
    return null;
  }

  const rawCursor = input['cursor'];

  if (rawCursor == null) {
    return { cursor: null, limit };
  }

  if (
    typeof rawCursor !== 'string' ||
    !UID_PATTERN.test(rawCursor)
  ) {
    return null;
  }

  return { cursor: rawCursor, limit };
}

export function projectAdminUserRow(
  uid: string,
  data: Record<string, unknown>
): AdminUserRow {
  const rawNickname =
    typeof data['nickname'] === 'string'
      ? data['nickname'].trim()
      : '';

  const nickname =
    rawNickname.length > 0 &&
    rawNickname.length <= 80 &&
    !EMAIL_PATTERN.test(rawNickname)
      ? rawNickname
      : null;

  const status = String(data['accountStatus'] ?? '');

  const allowedStatuses = [
    'active',
    'self_suspended',
    'moderation_suspended',
    'pending_deletion',
    'deleted'
  ];

  return {
    uid,
    nickname,
    profileCompleted: data['profileCompleted'] === true,
    accountStatus: allowedStatuses.includes(status)
      ? status
      : 'unknown',
    suspended: data['suspended'] === true,
    accountLocked: data['accountLocked'] === true,
    interactionBlocked: data['interactionBlocked'] === true,
    loginAllowed: data['loginAllowed'] !== false
  };
}

export function buildAdminUsersPage(
  documents: readonly AdminUserDocument[],
  limit: number
): AdminUsersPageResponse {
  const page = documents.slice(0, limit);
  const hasMore = documents.length > limit;

  return {
    items: page.map(document =>
      projectAdminUserRow(document.id, document.data)
    ),
    nextCursor: hasMore && page.length > 0
      ? page[page.length - 1].id
      : null,
    hasMore
  };
}
