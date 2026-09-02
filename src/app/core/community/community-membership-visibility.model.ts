// src/app/core/community/community-membership-visibility.model.ts
// -----------------------------------------------------------------------------
// COMMUNITY MEMBERSHIP VISIBILITY - CANONICAL CLIENT CONTRACT
// -----------------------------------------------------------------------------
// Participação comum é privada por padrão. Associação oficial pertence a outro
// contrato e nunca é inferida deste estado.
// -----------------------------------------------------------------------------

export type CommunityMemberProfileVisibility = 'hidden' | 'visible';

export type CommunityMembershipDisclosureMode = 'disabled' | 'opt_in';

export interface CommunityMembershipDisclosurePolicy {
  /**
   * `disabled`: a Comunidade não permite exibir vínculo de participação.
   * `opt_in`: cada membro ainda precisa autorizar explicitamente sua exposição.
   */
  profileMembership: CommunityMembershipDisclosureMode;
}

export interface CommunityMemberVisibilityPreference {
  /** Ausência do campo persistido deve ser tratada exatamente como `hidden`. */
  profileVisibility: CommunityMemberProfileVisibility;
}

export const DEFAULT_COMMUNITY_MEMBERSHIP_DISCLOSURE_POLICY:
  Readonly<CommunityMembershipDisclosurePolicy> = Object.freeze({
    profileMembership: 'disabled',
  });

export const DEFAULT_COMMUNITY_MEMBER_VISIBILITY_PREFERENCE:
  Readonly<CommunityMemberVisibilityPreference> = Object.freeze({
    profileVisibility: 'hidden',
  });

export function normalizeCommunityMembershipDisclosurePolicy(
  raw: unknown
): CommunityMembershipDisclosurePolicy {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    profileMembership:
      source['profileMembership'] === 'opt_in' ? 'opt_in' : 'disabled',
  };
}

export function normalizeCommunityMemberVisibilityPreference(
  raw: unknown
): CommunityMemberVisibilityPreference {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    profileVisibility:
      source['profileVisibility'] === 'visible' ? 'visible' : 'hidden',
  };
}
