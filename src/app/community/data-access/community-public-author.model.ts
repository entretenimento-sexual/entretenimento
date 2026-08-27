// -----------------------------------------------------------------------------
// COMMUNITY PUBLIC AUTHOR - COMPATIBILITY ADAPTER
// -----------------------------------------------------------------------------
// Comunidades deixa de possuir domínio próprio de identidade. O tipo abaixo
// aceita snapshots/fixtures legados que ainda possuem somente label/avatar,
// enquanto toda resposta normalizada já usa PublicUserIdentity.
// -----------------------------------------------------------------------------

import type { ProfileIdentityDiscoveryGroup } from '../../core/domain/profile-identity/profile-identity.catalog';
import {
  PublicUserIdentity,
  normalizePublicUserIdentity,
} from '../../core/domain/public-user-identity/public-user-identity.model';

export type CommunityPublicProfileType = ProfileIdentityDiscoveryGroup;
export type CommunityPublicAuthor = Pick<PublicUserIdentity, 'label' | 'avatarUrl'>
  & Partial<Omit<PublicUserIdentity, 'label' | 'avatarUrl'>>;

export const normalizeCommunityPublicAuthor = normalizePublicUserIdentity;
