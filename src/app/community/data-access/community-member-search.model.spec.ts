import { describe, expect, it } from 'vitest';

import { normalizeCommunityMemberSearchPage } from './community-member-search.model';

const profileId = 'profile-00000000-0000-4000-8000-000000000001';

describe('normalizeCommunityMemberSearchPage', () => {
  it('aceita identidade pública e cursor opaco versionado', () => {
    const page = normalizeCommunityMemberSearchPage({
      items: [{
        memberKey: profileId,
        identity: {
          profileId,
          nickname: 'Ana',
          avatarUrl: null,
        },
        role: 'member',
      }],
      nextCursor: 'v1_Y3Vyc29y',
      memberCount: 1,
      generatedAt: 123,
    });

    expect(page?.items).toHaveLength(1);
    expect(page?.nextCursor).toBe('v1_Y3Vyc29y');
  });

  it('rejeita cursor que tente transportar identificador interno', () => {
    expect(normalizeCommunityMemberSearchPage({
      items: [],
      nextCursor: 'uid-interno',
      memberCount: 0,
      generatedAt: 123,
    })).toBeNull();
  });
});
