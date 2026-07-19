// src/app/community/data-access/venue-community-create.model.spec.ts
import { describe, expect, it } from 'vitest';

import { normalizeVenueCommunityCreateResult } from './venue-community-create.model';

describe('venue community creation result', () => {
  it('normaliza IDs seguros e o estado de criação', () => {
    expect(
      normalizeVenueCommunityCreateResult({
        venueId: 'venue-request-1234567890',
        communityId: 'community-request-1234567890',
        created: true,
      })
    ).toEqual({
      venueId: 'venue-request-1234567890',
      communityId: 'community-request-1234567890',
      created: true,
    });
  });

  it('falha fechado para resposta incompleta ou insegura', () => {
    expect(
      normalizeVenueCommunityCreateResult({
        venueId: '../venue',
        communityId: 'community-safe',
      })
    ).toBeNull();
    expect(normalizeVenueCommunityCreateResult(null)).toBeNull();
  });
});
