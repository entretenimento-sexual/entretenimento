// src/app/core/community/community.model.spec.ts
import { describe, expect, it } from 'vitest';

import {
  COMMUNITY_SOURCE_TYPES,
  COMMUNITY_STATUSES,
  isCommunitySourceType,
  isCommunityStatus,
} from './community.model';

describe('community domain model', () => {
  it('mantém apenas Comunidade e Local como origens comunitárias', () => {
    expect(COMMUNITY_SOURCE_TYPES).toEqual(['community', 'venue']);
    expect(isCommunitySourceType('community')).toBe(true);
    expect(isCommunitySourceType('venue')).toBe(true);
    expect(isCommunitySourceType('room')).toBe(false);
  });

  it('mantém o lifecycle canônico completo', () => {
    expect(COMMUNITY_STATUSES).toEqual([
      'active',
      'paused',
      'dormant',
      'archived',
      'scheduled_for_deletion',
    ]);
    expect(isCommunityStatus('dormant')).toBe(true);
    expect(isCommunityStatus('scheduled_for_deletion')).toBe(true);
    expect(isCommunityStatus('deleted')).toBe(false);
  });

  it('falha fechado para valores desconhecidos ou ausentes', () => {
    expect(isCommunitySourceType('')).toBe(false);
    expect(isCommunitySourceType('group')).toBe(false);
    expect(isCommunitySourceType(null)).toBe(false);
    expect(isCommunitySourceType(undefined)).toBe(false);
    expect(isCommunityStatus('')).toBe(false);
    expect(isCommunityStatus(null)).toBe(false);
    expect(isCommunityStatus(undefined)).toBe(false);
  });
});
