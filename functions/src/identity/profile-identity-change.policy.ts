// A alteração de identidade pessoal é executada pelo backend sem fila humana.
// Intervalos limitam alternâncias deliberadas; não classificam identidade como fraude.
import { isCoupleProfileIdentityCode, isSelectableProfileIdentityCode } from './profile-identity.catalog';

export const PROFILE_IDENTITY_CHANGE_COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

export type ProfileIdentityRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';

export function normalizeRequestedIdentityCode(value: unknown): string | null {
  const code = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return isSelectableProfileIdentityCode(code) ? code : null;
}

export function isStructuralProfileTypeChange(from: unknown, to: unknown): boolean {
  const current = String(from ?? '').trim().toLowerCase();
  const requested = String(to ?? '').trim().toLowerCase();
  return current !== requested &&
    (isCoupleProfileIdentityCode(current) || isCoupleProfileIdentityCode(requested));
}

export function canRequestIdentityChange(input: {
  currentCode: unknown;
  requestedCode: unknown;
  activeStatus?: unknown;
  reviewedAt?: unknown;
  now: number;
}): 'allowed' | 'same-identity' | 'structural-change' | 'rate-limited' | 'invalid' {
  const target = normalizeRequestedIdentityCode(input.requestedCode);
  if (!target) return 'invalid';
  const current = String(input.currentCode ?? '').trim().toLowerCase();
  if (current === target) return 'same-identity';
  if (isStructuralProfileTypeChange(current, target)) return 'structural-change';
  const lastChange = Number(input.reviewedAt);
  if (input.activeStatus === 'APPROVED' && Number.isFinite(lastChange) &&
      lastChange > 0 && input.now - lastChange < PROFILE_IDENTITY_CHANGE_COOLDOWN_MS) {
    return 'rate-limited';
  }
  // Solicitações PENDING do fluxo legado são resolvidas pelo próprio titular.
  return 'allowed';
}
