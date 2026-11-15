export interface AdminUserDetailRequest {
  uid: string;
}

export function parseAdminUserDetailRequest(
  input: unknown
): AdminUserDetailRequest | null {
  if (
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return null;
  }

  const value = input as Record<string, unknown>;
  const keys = Object.keys(value);

  if (
    keys.length !== 1 ||
    keys[0] !== 'uid' ||
    typeof value['uid'] !== 'string'
  ) {
    return null;
  }

  const uid = value['uid'];

  if (
    uid !== uid.trim() ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(uid)
  ) {
    return null;
  }

  return { uid };
}
