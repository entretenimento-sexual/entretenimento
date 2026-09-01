import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityCreationCapability,
  normalizeCommunityCapacityPreview,
  normalizeCommunityMemberLimit,
} from './community-capacity.model';

const PREMIUM_OPTIONS = [
  { memberLimit: 25, requirement: 'basic', allowed: true },
  { memberLimit: 50, requirement: 'basic', allowed: true },
  { memberLimit: 100, requirement: 'basic', allowed: true },
  { memberLimit: 250, requirement: 'premium', allowed: true },
  { memberLimit: 500, requirement: 'vip', allowed: false },
  { memberLimit: 1_000, requirement: 'special_access', allowed: false },
] as const;

describe('community capacity normalization', () => {
  it('deriva no client somente os limites liberados pela capability autoritativa', () => {
    expect(normalizeCommunityCreationCapability({
      canCreate: true,
      reason: null,
      sponsorRole: 'premium',
      minimumRole: 'basic',
      recommendedUpgradeRole: null,
      currentOwnedCommunities: 1,
      maxOwnedCommunities: 3,
      memberLimit: 250,
      memberLimitOptions: [
        ...PREMIUM_OPTIONS,
        { memberLimit: 25, requirement: 'basic', allowed: true },
      ],
      allowedMemberLimits: [500],
      generatedAt: 100,
    })).toEqual({
      canCreate: true,
      reason: null,
      sponsorRole: 'premium',
      minimumRole: 'basic',
      recommendedUpgradeRole: null,
      currentOwnedCommunities: 1,
      maxOwnedCommunities: 3,
      memberLimit: 250,
      memberLimitOptions: PREMIUM_OPTIONS,
      allowedMemberLimits: [25, 50, 100, 250],
      generatedAt: 100,
    });
  });

  it('não mantém enumeração comercial de capacidades no Angular', () => {
    expect(normalizeCommunityMemberLimit(320)).toBe(320);
    expect(normalizeCommunityMemberLimit(1_250)).toBe(1_250);
    expect(normalizeCommunityMemberLimit('320')).toBeNull();
    expect(normalizeCommunityMemberLimit(0)).toBeNull();
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
      recommendedUpgradeRole: 'basic',
      currentOwnedCommunities: 0,
      maxOwnedCommunities: 0,
      memberLimit: 0,
      memberLimitOptions: PREMIUM_OPTIONS.map((option) => ({
        ...option,
        allowed: false,
      })),
      generatedAt: 100,
    })).toEqual({
      canCreate: false,
      reason: 'subscription_required',
      sponsorRole: 'free',
      minimumRole: 'basic',
      recommendedUpgradeRole: 'basic',
      currentOwnedCommunities: 0,
      maxOwnedCommunities: 0,
      memberLimit: 0,
      memberLimitOptions: PREMIUM_OPTIONS.map((option) => ({
        ...option,
        allowed: false,
      })),
      allowedMemberLimits: [],
      generatedAt: 100,
    });

    expect(normalizeCommunityCreationCapability({
      canCreate: true,
      reason: 'limit_reached',
      sponsorRole: 'basic',
      minimumRole: 'basic',
      recommendedUpgradeRole: 'premium',
      currentOwnedCommunities: 1,
      maxOwnedCommunities: 1,
      memberLimit: 100,
      memberLimitOptions: PREMIUM_OPTIONS.map((option) => ({
        ...option,
        allowed: option.memberLimit <= 100,
      })),
      generatedAt: 100,
    })).toBeNull();
  });

  it('rejeita capability com requisito de capacidade desconhecido', () => {
    expect(normalizeCommunityCreationCapability({
      canCreate: true,
      reason: null,
      sponsorRole: 'basic',
      minimumRole: 'basic',
      recommendedUpgradeRole: null,
      currentOwnedCommunities: 0,
      maxOwnedCommunities: 1,
      memberLimit: 100,
      memberLimitOptions: [
        { memberLimit: 25, requirement: 'gold', allowed: true },
      ],
      generatedAt: 100,
    })).toBeNull();
  });
});
