// src/app/community/data-access/community-discovery.contract.spec.ts
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE,
  MAX_COMMUNITY_DISCOVERY_PAGE_SIZE,
  MIN_COMMUNITY_DISCOVERY_PAGE_SIZE,
  normalizeCommunityDiscoveryPageSize,
} from './community-discovery.contract';

describe('community discovery client contract', () => {
  it('mantém o mesmo envelope de paginação aceito pelo backend', () => {
    expect(DEFAULT_COMMUNITY_DISCOVERY_PAGE_SIZE).toBe(12);
    expect(MIN_COMMUNITY_DISCOVERY_PAGE_SIZE).toBe(1);
    expect(MAX_COMMUNITY_DISCOVERY_PAGE_SIZE).toBe(24);

    expect(normalizeCommunityDiscoveryPageSize(undefined)).toBe(12);
    expect(normalizeCommunityDiscoveryPageSize(0)).toBe(1);
    expect(normalizeCommunityDiscoveryPageSize(6)).toBe(6);
    expect(normalizeCommunityDiscoveryPageSize(24)).toBe(24);
    expect(normalizeCommunityDiscoveryPageSize(48)).toBe(24);
    expect(normalizeCommunityDiscoveryPageSize(999)).toBe(24);
  });
});
