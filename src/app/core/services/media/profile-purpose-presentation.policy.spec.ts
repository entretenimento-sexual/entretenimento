import { describe, expect, it } from 'vitest';

import {
  resolvePublicProfilePurposePresentation,
  resolvePublicMediaPurposePresentation,
} from './profile-purpose-presentation.policy';

describe('future public profile purpose presentation', () => {
  it('does not infer professional status from payments or subscription tiers', () => {
    expect(resolvePublicProfilePurposePresentation({
      tier: 'premium', isSubscriber: true, role: 'vip',
      isCommercial: true, bio: 'trabalho profissional',
    })).toBeNull();
  });

  it('rejects an unverified professional claim even when display was requested', () => {
    expect(resolvePublicProfilePurposePresentation({
      schemaVersion: 1, purpose: 'PROFESSIONAL',
      evidence: 'SELF_DECLARED', publishLabel: true,
    })).toBeNull();
  });

  it('supports explicit backend-verified professional distinction', () => {
    expect(resolvePublicProfilePurposePresentation({
      schemaVersion: 1, purpose: 'PROFESSIONAL',
      evidence: 'BACKEND_VERIFIED', publishLabel: true,
    })).toEqual({ label: 'Perfil profissional', verified: true });
  });

  it('supports a voluntary personal identity without claiming financial facts', () => {
    expect(resolvePublicProfilePurposePresentation({
      schemaVersion: 1, purpose: 'PERSONAL_SOCIAL',
      evidence: 'SELF_DECLARED', publishLabel: true,
    })).toEqual({ label: 'Perfil pessoal', verified: false });
  });

  it('never publishes a category without opt-in or on unknown legacy data', () => {
    for (const value of [null, {}, { schemaVersion: 2, publishLabel: true },
      { schemaVersion: 1, purpose: 'PROFESSIONAL',
        evidence: 'BACKEND_VERIFIED', publishLabel: false }]) {
      expect(resolvePublicProfilePurposePresentation(value)).toBeNull();
    }
  });
});

describe('future media purpose classification', () => {
  it('does not promote self-declared professional content without a verified owner', () => {
    const media = {
      schemaVersion: 1, purpose: 'PROFESSIONAL_PORTFOLIO',
      publishLabel: true, verifiedOwnerPurpose: {
        schemaVersion: 1, purpose: 'PROFESSIONAL',
        evidence: 'SELF_DECLARED', publishLabel: true,
      },
    };
    expect(resolvePublicMediaPurposePresentation(media)).toBeNull();
  });

  it('permits an explicit professional label only with a current verified owner projection', () => {
    expect(resolvePublicMediaPurposePresentation({
      schemaVersion: 1, purpose: 'PROFESSIONAL_PORTFOLIO',
      publishLabel: true,
      verifiedOwnerPurpose: {
        schemaVersion: 1, purpose: 'PROFESSIONAL',
        evidence: 'BACKEND_VERIFIED', publishLabel: true,
      },
    })).toBe('Conteúdo profissional');
  });

  it('keeps personal publications independent from commercial profile status', () => {
    expect(resolvePublicMediaPurposePresentation({
      schemaVersion: 1, purpose: 'PERSONAL_SOCIAL',
      publishLabel: true, verifiedOwnerPurpose: null,
    })).toBe('Conteúdo pessoal');
    expect(resolvePublicMediaPurposePresentation({
      schemaVersion: 1, purpose: 'PERSONAL_SOCIAL',
      publishLabel: false, verifiedOwnerPurpose: null,
    })).toBeNull();
  });
});
