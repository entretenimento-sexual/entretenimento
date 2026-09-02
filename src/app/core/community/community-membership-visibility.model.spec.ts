import { describe, expect, it } from 'vitest';

import {
  normalizeCommunityMemberVisibilityPreference,
  normalizeCommunityMembershipDisclosurePolicy,
} from './community-membership-visibility.model';

describe('community membership visibility contract', () => {
  it('falha fechado quando a Comunidade não declara política de exposição', () => {
    expect(normalizeCommunityMembershipDisclosurePolicy(null)).toEqual({
      profileMembership: 'disabled',
    });
  });

  it('falha fechado quando o membro não declarou visibilidade', () => {
    expect(normalizeCommunityMemberVisibilityPreference(undefined)).toEqual({
      profileVisibility: 'hidden',
    });
  });

  it('aceita somente opt-in explícito de ambas as partes', () => {
    expect(normalizeCommunityMembershipDisclosurePolicy({
      profileMembership: 'opt_in',
    })).toEqual({ profileMembership: 'opt_in' });

    expect(normalizeCommunityMemberVisibilityPreference({
      profileVisibility: 'visible',
    })).toEqual({ profileVisibility: 'visible' });
  });

  it('não promove valores desconhecidos para visível', () => {
    expect(normalizeCommunityMembershipDisclosurePolicy({
      profileMembership: 'public',
    })).toEqual({ profileMembership: 'disabled' });

    expect(normalizeCommunityMemberVisibilityPreference({
      profileVisibility: true,
    })).toEqual({ profileVisibility: 'hidden' });
  });
});
