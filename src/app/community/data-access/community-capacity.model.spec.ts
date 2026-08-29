import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityCreationCapability,
  normalizeCommunityCapacityPreview,
} from './community-capacity.model';

describe('community capacity normalization', () => {
  it('mantém no client somente limites retornados pela capability autoritativa', () => {
    expect(normalizeCommunityCreationCapability({
      canCreate: true,
      reason: null,
      sponsorRole: 'premium',
      minimumRole: 'basic',
      currentOwnedCommunities: 1,
      maxOwnedCommunities: 3,
      memberLimit: 250,
      allowedMemberLimits: [25, 50, 100, 250, 500, 25],
      generatedAt: 100,
    })).toEqual({
      canCreate: true,
      reason: null,
      sponsorRole: 'premium',
      minimumRole: 'basic',
      currentOwnedCommunities: 1,
      maxOwnedCommunities: 3,
      memberLimit: 250,
      allowedMemberLimits: [25, 50, 100, 250],
      generatedAt: 100,
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
