import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityMemberVisibilityPreference,
  normalizeCommunityMembershipDisclosurePolicy,
} from './community-membership-visibility.model';

describe('community membership visibility contract', () => {
  it('falha fechado quando a Comunidade não declara política de exposição', () => {
    expect(normalizeCommunityMembershipDisclosurePolicy(null)).toEqual({
      profileMembership: 'disabled',
      policyVersion: 1,
    });
  });

  it('falha fechado quando o membro não declarou visibilidade', () => {
    expect(normalizeCommunityMemberVisibilityPreference(undefined)).toEqual({
      profileVisibility: 'hidden',
      profileVisibilityPolicyVersion: null,
    });
  });

  it('aceita somente opt-in explícito associado a uma versão válida', () => {
    expect(normalizeCommunityMembershipDisclosurePolicy({
      profileMembership: 'opt_in',
      policyVersion: 3,
    })).toEqual({
      profileMembership: 'opt_in',
      policyVersion: 3,
    });

    expect(normalizeCommunityMemberVisibilityPreference({
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 3,
    })).toEqual({
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: 3,
    });
  });

  it('não promove opt-in sem versão correspondente', () => {
    expect(normalizeCommunityMemberVisibilityPreference({
      profileVisibility: 'visible',
    })).toEqual({
      profileVisibility: 'visible',
      profileVisibilityPolicyVersion: null,
    });
  });

  it('não promove valores desconhecidos para visível', () => {
    expect(normalizeCommunityMembershipDisclosurePolicy({
      profileMembership: 'public',
      policyVersion: 0,
    })).toEqual({
      profileMembership: 'disabled',
      policyVersion: 1,
    });

    expect(normalizeCommunityMemberVisibilityPreference({
      profileVisibility: true,
      profileVisibilityPolicyVersion: 7,
    })).toEqual({
      profileVisibility: 'hidden',
      profileVisibilityPolicyVersion: null,
    });
  });
});
