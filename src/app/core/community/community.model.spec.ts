// src/app/core/community/community.model.spec.ts
import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_SOURCE_TYPES,
  isCommunitySourceType,
} from './community.model';

describe('community domain source', () => {
  it('mantém apenas Comunidade e Local como origens comunitárias', () => {
    expect(COMMUNITY_SOURCE_TYPES).toEqual(['community', 'venue']);
    expect(isCommunitySourceType('community')).toBe(true);
    expect(isCommunitySourceType('venue')).toBe(true);
    expect(isCommunitySourceType('room')).toBe(false);
  });

  it('falha fechado para valores desconhecidos ou ausentes', () => {
    expect(isCommunitySourceType('')).toBe(false);
    expect(isCommunitySourceType('group')).toBe(false);
    expect(isCommunitySourceType(null)).toBe(false);
    expect(isCommunitySourceType(undefined)).toBe(false);
  });
});
