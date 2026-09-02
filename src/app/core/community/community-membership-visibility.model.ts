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
  /**
   * Incrementada quando a regra de disclosure muda de forma material. Um opt-in
   * de membro só é válido para a mesma versão, evitando reativação silenciosa.
   */
  policyVersion: number;
}

export interface CommunityMemberVisibilityPreference {
  /** Ausência do campo persistido deve ser tratada exatamente como `hidden`. */
  profileVisibility: CommunityMemberProfileVisibility;
  /** Versão da policy explicitamente aceita pelo membro; null quando oculto. */
  profileVisibilityPolicyVersion: number | null;
}

export const DEFAULT_COMMUNITY_MEMBERSHIP_DISCLOSURE_POLICY:
  Readonly<CommunityMembershipDisclosurePolicy> = Object.freeze({
    profileMembership: 'disabled',
    policyVersion: 1,
  });

export const DEFAULT_COMMUNITY_MEMBER_VISIBILITY_PREFERENCE:
  Readonly<CommunityMemberVisibilityPreference> = Object.freeze({
    profileVisibility: 'hidden',
    profileVisibilityPolicyVersion: null,
  });

function normalizePolicyVersion(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
}

export function normalizeCommunityMembershipDisclosurePolicy(
  raw: unknown
): CommunityMembershipDisclosurePolicy {
  const source = (raw ?? {}) as Record<string, unknown>;
  return {
    profileMembership:
      source['profileMembership'] === 'opt_in' ? 'opt_in' : 'disabled',
    policyVersion: normalizePolicyVersion(source['policyVersion']),
  };
}

export function normalizeCommunityMemberVisibilityPreference(
  raw: unknown
): CommunityMemberVisibilityPreference {
  const source = (raw ?? {}) as Record<string, unknown>;
  const profileVisibility =
    source['profileVisibility'] === 'visible' ? 'visible' : 'hidden';
  const parsedPolicyVersion = Math.trunc(
    Number(source['profileVisibilityPolicyVersion'])
  );

  return {
    profileVisibility,
    profileVisibilityPolicyVersion:
      profileVisibility === 'visible'
      && Number.isFinite(parsedPolicyVersion)
      && parsedPolicyVersion >= 1
        ? parsedPolicyVersion
        : null,
  };
}
