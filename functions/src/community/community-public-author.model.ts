// -----------------------------------------------------------------------------
// COMMUNITY PUBLIC AUTHOR - COMPATIBILITY ADAPTER
// -----------------------------------------------------------------------------
// Comunidades não possui mais domínio próprio de identidade. Snapshots legados
// continuam aceitos enquanto a hidratação backend produz PublicUserIdentity.
// -----------------------------------------------------------------------------

import { hasLegacyPrivateDiscoveryFields } from '../discovery/legacy-public-profile-preservation.policy';
import type { ProfileIdentityDiscoveryGroup } from '../identity/profile-identity.catalog';
import {
  PublicUserIdentity,
  PublicUserIdentityFallback,
  buildPublicUserIdentity,
} from '../identity/public-user-identity.model';

export type CommunityPublicProfileType = ProfileIdentityDiscoveryGroup;
export type CommunityPublicAuthor = Pick<PublicUserIdentity, 'label' | 'avatarUrl'>
  & Partial<Omit<PublicUserIdentity, 'label' | 'avatarUrl'>>;
export type CommunityPublicAuthorFallback = PublicUserIdentityFallback;

/**
 * Quarentena dos campos privados legados em todas as identidades de Comunidades.
 * Um fallback historico nao autoriza republicar nickname/avatar antigos.
 */
export function buildCommunityPublicAuthor(
  rawProfile: unknown,
  fallback: CommunityPublicAuthorFallback
): CommunityPublicAuthor {
  if (hasLegacyPrivateDiscoveryFields(rawProfile)) {
    return buildPublicUserIdentity(null, {
      label: 'Participante',
      avatarUrl: null,
    });
  }

  return buildPublicUserIdentity(rawProfile, fallback);
}
