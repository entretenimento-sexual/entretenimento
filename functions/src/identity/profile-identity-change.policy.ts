// Identity changes are reviewed: ordinary profile edits cannot rewrite the
// established discovery identity or transform an individual into a couple.
// The previous declaration stays private; no public change history is created.
import { isSelectableProfileIdentityCode } from './profile-identity.catalog';

export type ProfileIdentityRequestStatus =
  | 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';

export function normalizeRequestedIdentityCode(value: unknown): string | null {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isSelectableProfileIdentityCode(code) ? code : null;
}

export function canRequestIdentityChange(input: {
  currentCode: unknown;
  requestedCode: unknown;
  activeStatus?: unknown;
  requestedAt?: unknown;
  now: number;
}): 'allowed' | 'same-identity' | 'pending' | 'rate-limited' | 'invalid' {
  const target = normalizeRequestedIdentityCode(input.requestedCode);
  if (!target) return 'invalid';
  if (String(input.currentCode ?? '').trim().toLowerCase() === target) {
    return 'same-identity';
  }
  if (input.activeStatus === 'PENDING') return 'pending';
  const last = Number(input.requestedAt);
  if (
    input.activeStatus === 'REJECTED' &&
    Number.isFinite(last) && last > 0 &&
    input.now - last < 7 * 24 * 60 * 60 * 1000
  ) return 'rate-limited';
  return 'allowed';
}
