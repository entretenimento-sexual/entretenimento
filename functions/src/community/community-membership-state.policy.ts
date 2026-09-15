// functions/src/community/community-membership-state.policy.ts
import type { CommunityMembershipStatus } from './community-membership-request.policy';

export type ExistingCommunityMembershipState =
  | Readonly<{ kind: 'absent'; status: null }>
  | Readonly<{ kind: 'valid'; status: CommunityMembershipStatus }>
  | Readonly<{ kind: 'invalid'; status: null }>;

export function normalizePersistedCommunityMembershipStatus(
  value: unknown
): CommunityMembershipStatus | null {
  return value === 'active'
    || value === 'pending'
    || value === 'blocked'
    || value === 'left'
    ? value
    : null;
}

/**
 * Diferencia ausência real de membership de documento existente corrompido.
 * Writers de entrada devem falhar fechados para `invalid`; somente `absent`
 * pode seguir o mesmo fluxo de um usuário sem vínculo anterior.
 */
export function classifyExistingCommunityMembershipState(
  exists: boolean,
  rawStatus: unknown
): ExistingCommunityMembershipState {
  if (!exists) {
    return { kind: 'absent', status: null };
  }

  const status = normalizePersistedCommunityMembershipStatus(rawStatus);
  if (status === null) {
    return { kind: 'invalid', status: null };
  }

  return { kind: 'valid', status };
}
