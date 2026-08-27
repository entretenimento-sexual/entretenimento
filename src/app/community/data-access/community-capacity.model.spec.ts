import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityCreationCapability,
  normalizeCommunityCapacityPreview,
  resolveCommunityMemberLimitOptions,
  resolvePersonalCommunityCreationPolicy,
} from './community-capacity.model';

describe('community capacity normalization', () => {
  it('mantém as opções dentro do teto de cada plano', () => {
    expect(resolveCommunityMemberLimitOptions('free')).toEqual([]);
    expect(resolveCommunityMemberLimitOptions('basic')).toEqual([25, 50, 100]);
    expect(resolveCommunityMemberLimitOptions('premium')).toEqual([
      25,
      50,
      100,
      250,
    ]);
    expect(resolveCommunityMemberLimitOptions('vip')).toEqual([
      25,
      50,
      100,
      250,
      500,
    ]);
  });

  it('mantém criação pessoal separada da capacidade comercial', () => {
    expect(resolvePersonalCommunityCreationPolicy('free')).toEqual({
      canCreate: false,
      maxOwnedCommunities: 0,
      memberLimit: 0,
    });
    expect(resolvePersonalCommunityCreationPolicy('basic')).toEqual({
      canCreate: true,
      maxOwnedCommunities: 1,
      memberLimit: 100,
    });
    expect(resolvePersonalCommunityCreationPolicy('premium')).toEqual({
      canCreate: true,
      maxOwnedCommunities: 3,
      memberLimit: 250,
    });
    expect(resolvePersonalCommunityCreationPolicy('vip')).toEqual({
      canCreate: true,
      maxOwnedCommunities: 5,
      memberLimit: 500,
    });
  });

  it('deriva o bloqueio de entrada da contagem e do limite efetivo', () => {
    expect(normalizeCommunityCapacityPreview({
      configuredLimit: 250,
      effectiveLimit: 25,
      memberCount: 25,
      acceptingNewMembers: true,
      restrictedByOwnerPlan: false,
      allowedMemberLimits: [25, 25, 90],
    })).toEqual({
      configuredLimit: 250,
      effectiveLimit: 25,
      memberCount: 25,
      acceptingNewMembers: false,
      restrictedByOwnerPlan: true,
      allowedMemberLimits: [25],
    });
  });

  it('falha fechado para contagem implícita ou limites incoerentes', () => {
    expect(normalizeCommunityCapacityPreview({
      configuredLimit: 25,
      effectiveLimit: 25,
      memberCount: null,
    })).toBeNull();
    expect(normalizeCommunityCapacityPreview({
      configuredLimit: 25,
      effectiveLimit: 50,
      memberCount: 1,
    })).toBeNull();
  });

  it('aceita teto efetivo zero após downgrade para Free', () => {
    expect(normalizeCommunityCapacityPreview({
      configuredLimit: 100,
      effectiveLimit: 0,
      memberCount: 40,
      acceptingNewMembers: true,
      restrictedByOwnerPlan: true,
      allowedMemberLimits: [],
    })?.acceptingNewMembers).toBe(false);
  });

  it('normaliza capability autoritativa e falha fechado em contradições', () => {
    expect(normalizeCommunityCreationCapability({
      canCreate: false,
      reason: 'subscription_required',
      sponsorRole: 'free',
      minimumRole: 'basic',
      currentOwnedCommunities: 0,
      maxOwnedCommunities: 0,
      memberLimit: 0,
      allowedMemberLimits: [],
      generatedAt: 100,
    })).toEqual({
      canCreate: false,
      reason: 'subscription_required',
      sponsorRole: 'free',
      minimumRole: 'basic',
      currentOwnedCommunities: 0,
      maxOwnedCommunities: 0,
      memberLimit: 0,
      allowedMemberLimits: [],
      generatedAt: 100,
    });

    expect(normalizeCommunityCreationCapability({
      canCreate: true,
      reason: 'limit_reached',
      sponsorRole: 'basic',
      minimumRole: 'basic',
      currentOwnedCommunities: 1,
      maxOwnedCommunities: 1,
      memberLimit: 100,
      allowedMemberLimits: [25, 50, 100],
      generatedAt: 100,
    })).toBeNull();
  });
});
