// -----------------------------------------------------------------------------
// COMMUNITY PUBLIC AUTHOR - COMPATIBILITY ADAPTER
// -----------------------------------------------------------------------------
// Comunidades não possui mais domínio próprio de identidade. Snapshots legados
// continuam aceitos enquanto a hidratação backend produz PublicUserIdentity.
// -----------------------------------------------------------------------------

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

export const buildCommunityPublicAuthor = buildPublicUserIdentity;
