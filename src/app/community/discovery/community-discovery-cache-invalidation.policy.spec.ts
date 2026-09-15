import { describe, expect, it } from 'vitest';

import {
  resolveCommunityMemberManagementDiscoveryInvalidation,
  resolveCommunityMembershipReviewDiscoveryInvalidation,
} from './community-discovery-cache-invalidation.policy';

describe('community discovery cache invalidation policy', () => {
  it('invalida todas as consultas de Comunidades quando uma solicitação é aprovada', () => {
    expect(
      resolveCommunityMembershipReviewDiscoveryInvalidation(
        'approve',
        ' community-1 '
      )
    ).toEqual({ sourceType: 'community' });
  });

  it('mantém invalidação pontual quando uma solicitação é rejeitada', () => {
    expect(
      resolveCommunityMembershipReviewDiscoveryInvalidation(
        'reject',
        ' community-1 '
      )
    ).toEqual({
      sourceType: 'community',
      communityId: 'community-1',
    });
  });

  it.each(['remove', 'block'] as const)(
    'invalida todas as consultas de Comunidades após %s',
    (action) => {
      expect(
        resolveCommunityMemberManagementDiscoveryInvalidation(
          action,
          'community-1'
        )
      ).toEqual({ sourceType: 'community' });
    }
  );

  it.each(['set_role', 'unblock'] as const)(
    'não invalida discovery quando %s não altera composição nem memberCount',
    (action) => {
      expect(
        resolveCommunityMemberManagementDiscoveryInvalidation(
          action,
          'community-1'
        )
      ).toBeNull();
    }
  );

  it('falha fechado para communityId vazio', () => {
    expect(
      resolveCommunityMembershipReviewDiscoveryInvalidation('approve', '   ')
    ).toBeNull();
    expect(
      resolveCommunityMemberManagementDiscoveryInvalidation('block', '   ')
    ).toBeNull();
  });
});
