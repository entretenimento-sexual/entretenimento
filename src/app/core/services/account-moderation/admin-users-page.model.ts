export interface AdminUserRow {
  uid: string;
  nickname: string | null;
  profileCompleted: boolean;
  accountStatus:
    | 'active'
    | 'self_suspended'
    | 'moderation_suspended'
    | 'pending_deletion'
    | 'deleted'
    | 'unknown';
  suspended: boolean;
  accountLocked: boolean;
  interactionBlocked: boolean;
  loginAllowed: boolean;
}

export interface AdminUsersPageOptions {
  cursor?: string | null;
  limit?: number;
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

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

const STATUSES = [
  'active',
  'self_suspended',
  'moderation_suspended',
  'pending_deletion',
  'deleted',
  'unknown',
] as const;

const ROW_KEYS = [
  'uid',
  'nickname',
  'profileCompleted',
  'accountStatus',
  'suspended',
  'accountLocked',
  'interactionBlocked',
  'loginAllowed',
];

const RESPONSE_KEYS = [
  'items',
  'nextCursor',
  'hasMore',
];

function fail(): never {
  throw new Error('Invalid admin users response contract.');
}

function record(value: unknown): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    return fail();
  }

  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): void {
  const actual = Object.keys(value);

  if (
    actual.length !== expected.length ||
    expected.some(key =>
      !Object.prototype.hasOwnProperty.call(value, key)
    )
  ) {
    fail();
  }
}

export function normalizeAdminUsersPageRequest(
  options: AdminUsersPageOptions = {}
): AdminUsersPageRequest {
  const limit = options.limit ?? 25;
  const cursor = options.cursor ?? null;

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    (
      cursor !== null &&
      (
        typeof cursor !== 'string' ||
        !UID_PATTERN.test(cursor)
      )
    )
  ) {
    throw new Error('Invalid admin users page request.');
  }

  return { cursor, limit };
}

function parseRow(value: unknown): AdminUserRow {
  const raw = record(value);
  exactKeys(raw, ROW_KEYS);

  const uid = raw['uid'];
  const nickname = raw['nickname'];
  const accountStatus = raw['accountStatus'];

  if (
    typeof uid !== 'string' ||
    !UID_PATTERN.test(uid) ||
    (
      nickname !== null &&
      (
        typeof nickname !== 'string' ||
        nickname.length === 0 ||
        nickname.length > 80 ||
        nickname !== nickname.trim() ||
        nickname.includes('@')
      )
    ) ||
    typeof accountStatus !== 'string' ||
    !STATUSES.some(status => status === accountStatus)
  ) {
    fail();
  }

  const boolKeys = [
    'profileCompleted',
    'suspended',
    'accountLocked',
    'interactionBlocked',
    'loginAllowed',
  ] as const;

  if (
    boolKeys.some(key => typeof raw[key] !== 'boolean')
  ) {
    fail();
  }

  return {
    uid: uid as string,
    nickname: nickname as string | null,
    profileCompleted: raw['profileCompleted'] as boolean,
    accountStatus:
      accountStatus as AdminUserRow['accountStatus'],
    suspended: raw['suspended'] as boolean,
    accountLocked: raw['accountLocked'] as boolean,
    interactionBlocked: raw['interactionBlocked'] as boolean,
    loginAllowed: raw['loginAllowed'] as boolean,
  };
}

export function parseAdminUsersPageResponse(
  value: unknown,
  requestedLimit: number
): AdminUsersPageResponse {
  const raw = record(value);
  exactKeys(raw, RESPONSE_KEYS);

  if (
    !Array.isArray(raw['items']) ||
    !Number.isInteger(requestedLimit) ||
    requestedLimit < 1 ||
    requestedLimit > 50 ||
    raw['items'].length > requestedLimit ||
    typeof raw['hasMore'] !== 'boolean'
  ) {
    fail();
  }

  const nextCursor = raw['nextCursor'];

  if (
    nextCursor !== null &&
    (
      typeof nextCursor !== 'string' ||
      !UID_PATTERN.test(nextCursor)
    )
  ) {
    fail();
  }

  const items: AdminUserRow[] =
    raw['items'].map((item: unknown) => parseRow(item));

  if (new Set(items.map(item => item.uid)).size !== items.length) {
    fail();
  }

  const hasMore = raw['hasMore'] as boolean;

  if (
    (
      hasMore &&
      (
        items.length === 0 ||
        nextCursor !== items[items.length - 1].uid
      )
    ) ||
    (!hasMore && nextCursor !== null)
  ) {
    fail();
  }

  return {
    items,
    nextCursor: nextCursor as string | null,
    hasMore,
  };
}

export function parseAdminUserDetailResponse(
  value: unknown
): AdminUserRow | null {
  return value === null ? null : parseRow(value);
}
