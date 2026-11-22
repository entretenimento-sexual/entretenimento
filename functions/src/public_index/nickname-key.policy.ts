export const NICKNAME_INDEX_PREFIX = 'nickname:';

export function isNicknameIndexKey(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z0-9._-]{3,40}$/.test(value);
}

export function normalizeNicknameForIndex(value: unknown): string {
  const text = typeof value === 'string'
    ? value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    : '';
  if (/^[a-z0-9._\s-]+$/.test(text)) {
    return text.replace(/\s+/g, '_').slice(0, 40);
  }
  return text.replace(/[^a-z0-9._-]+/g, '_').replace(/^[._-]+|[._-]+$/g, '').slice(0, 40);
}

export function resolveNicknameNormalized(profile: { nickname?: unknown; nicknameNormalized?: unknown }): string {
  const stored = typeof profile.nicknameNormalized === 'string'
    ? profile.nicknameNormalized.trim().toLowerCase() : '';
  return isNicknameIndexKey(stored) ? stored : normalizeNicknameForIndex(profile.nickname);
}

type NicknameProjection = {
  uid?: unknown;
  nickname?: unknown;
  nicknameNormalized?: unknown;
  publicVisibility?: unknown;
};

export function isNicknamePublicProjectionAligned(
  uid: string, account: NicknameProjection, projection: NicknameProjection,
): boolean {
  const key = resolveNicknameNormalized(account);
  return account.uid === uid && projection.uid === uid &&
    (projection.publicVisibility == null || projection.publicVisibility === 'visible') &&
    typeof account.nickname === 'string' && typeof projection.nickname === 'string' &&
    projection.nickname.trim() === account.nickname.trim() &&
    isNicknameIndexKey(key) && resolveNicknameNormalized(projection) === key;
}
