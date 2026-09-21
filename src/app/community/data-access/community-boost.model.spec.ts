import { describe, expect, it } from 'vitest';

import {
  normalizeCommunitySponsoredPlacement,
} from './community-boost.model';

function communityCard() {
  return {
    communityId: 'community-sponsored',
    name: 'Comunidade Patrocinada',
    slug: 'comunidade-patrocinada',
    description: 'Descrição pública.',
    source: { type: 'community', id: 'community-sponsored' },
    avatarUrl: null,
    coverUrl: null,
    metrics: { memberCount: 10, postCount: 2, mediaCount: 1 },
    access: { join: 'approval' },
    tags: [],
    viewerRole: 'admin',
  };
}

describe('Community Boost public placement model', () => {
  it('mantém apenas disclosure + ids + card público sanitizado', () => {
    const placement = normalizeCommunitySponsoredPlacement({
      placementId: 'placement-1',
      campaignId: 'campaign-1',
      disclosure: 'Patrocinado',
      community: communityCard(),
      budgetCents: 50_000,
      rateCpmCents: 900,
      pacingDebtMilliCents: 123,
    });

    expect(placement).toEqual({
      placementId: 'placement-1',
      campaignId: 'campaign-1',
      disclosure: 'Patrocinado',
      community: expect.objectContaining({
        communityId: 'community-sponsored',
      }),
    });
    expect(placement?.community.viewerRole).toBeUndefined();
    expect(placement).not.toHaveProperty('budgetCents');
    expect(placement).not.toHaveProperty('rateCpmCents');
    expect(placement).not.toHaveProperty('pacingDebtMilliCents');
  });

  it('falha fechado para disclosure ou ids inválidos', () => {
    expect(normalizeCommunitySponsoredPlacement({
      placementId: 'placement-1',
      campaignId: 'campaign-1',
      disclosure: 'Destaque',
      community: communityCard(),
    })).toBeNull();

    expect(normalizeCommunitySponsoredPlacement({
      placementId: '../invalid',
      campaignId: 'campaign-1',
      disclosure: 'Patrocinado',
      community: communityCard(),
    })).toBeNull();
  });
});
