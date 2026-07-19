// src/app/community/data-access/community-create.model.spec.ts
import { describe, expect, it } from 'vitest';

import { normalizeCommunityCreateResult } from './community-create.model';

describe('normalizeCommunityCreateResult', () => {
  it('aceita somente identificador seguro devolvido pela Function', () => {
    expect(
      normalizeCommunityCreateResult({
        communityId: 'community-safe-1',
        created: true,
      })
    ).toEqual({
      communityId: 'community-safe-1',
      created: true,
    });

    expect(
      normalizeCommunityCreateResult({
        communityId: '../community-unsafe',
        created: true,
      })
    ).toBeNull();
  });
});
