import type { CommunityMemberManagementAction } from '../data-access/community-member-management.model';
import type { CommunityMembershipReviewAction } from '../data-access/community-membership.model';
import type { CommunityDiscoveryCacheInvalidationScope } from './community-discovery-cache.service';

/**
 * Mantém a invalidação do discovery proporcional ao efeito canônico da mutação.
 *
 * Alterações que podem mudar memberCount/composição/ranking invalidam todas as
 * consultas de Comunidades do viewer. Alterações sem efeito de composição
 * preservam invalidação pontual (ou nenhuma, quando o discovery não é afetado).
 */
export function resolveCommunityMembershipReviewDiscoveryInvalidation(
  action: CommunityMembershipReviewAction,
  communityIdValue: string
): CommunityDiscoveryCacheInvalidationScope | null {
  const communityId = communityIdValue.trim();
  if (!communityId) return null;

  return action === 'approve'
    ? { sourceType: 'community' }
    : { sourceType: 'community', communityId };
}

export function resolveCommunityMemberManagementDiscoveryInvalidation(
  action: CommunityMemberManagementAction,
  communityIdValue: string
): CommunityDiscoveryCacheInvalidationScope | null {
  const communityId = communityIdValue.trim();
  if (!communityId) return null;

  return action === 'remove' || action === 'block'
    ? { sourceType: 'community' }
    : null;
}
