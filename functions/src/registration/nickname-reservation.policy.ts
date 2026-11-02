// Canonical nickname normalization for authoritative backend registration.
// Do not trust display/key pairs sent by a browser; only raw display arrives.
const DISPLAY_PATTERN = /^[A-Za-z0-9._\- ]{4,24}$/;
const KEY_PATTERN = /^[a-z0-9._-]{3,40}$/;

export interface RegistrationNickname {
  readonly display: string;
  readonly key: string;
}

export function normalizeRegistrationNickname(value: unknown): RegistrationNickname | null {
  if (typeof value !== 'string') return null;
  const display = value.trim().replace(/\s+/g, ' ');
  if (!DISPLAY_PATTERN.test(display)) return null;
  const key = display.normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '');
  return KEY_PATTERN.test(key) ? { display, key } : null;
}

export function canClaimRegistrationNickname(input: {
  uid: string;
  requested: RegistrationNickname;
  currentDisplay?: unknown;
  completed?: boolean;
  indexOwnerUid?: unknown;
  reservationOwnerUid?: unknown;
}): 'allowed' | 'account-completed' | 'name-changed' | 'in-use' {
  if (input.completed === true) return 'account-completed';
  const current = String(input.currentDisplay ?? '').trim().replace(/\s+/g, ' ');
  if (current && current !== input.requested.display) return 'name-changed';
  for (const owner of [input.indexOwnerUid, input.reservationOwnerUid]) {
    if (owner !== undefined && owner !== null && String(owner).trim() !== input.uid) {
      return 'in-use';
    }
  }
  return 'allowed';
}
