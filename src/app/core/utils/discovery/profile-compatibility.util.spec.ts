import { describe, expect, it } from 'vitest';

import {
  evaluateProfileCompatibility,
  type ProfileCompatibilityLike,
} from './profile-compatibility.util';

function profile(
  uid: string,
  gender: string,
  orientation: string,
  overrides: Partial<ProfileCompatibilityLike> = {}
): ProfileCompatibilityLike {
  return {
    uid,
    gender,
    orientation,
    normalizedGender: gender,
    normalizedOrientation: orientation,
    compatibilityReady: true,
    ...overrides,
  };
}

describe('evaluateProfileCompatibility', () => {
  describe('compatibilidade entre homens', () => {
    const viewer = profile('viewer-man', 'man', 'homosexual');

    it.each([
      ['homossexual', 'homosexual'],
      ['bissexual', 'bisexual'],
      ['pansexual', 'pansexual'],
    ])('deve permitir homem homossexual com homem %s', (_, candidateOrientation) => {
      const candidate = profile('candidate-man', 'man', candidateOrientation);
      const result = evaluateProfileCompatibility(viewer, candidate);

      expect(result.compatible).toBe(true);
      expect(result.score).toBeGreaterThan(0);
      expect(result.viewerGender).toBe('man');
      expect(result.candidateGender).toBe('man');
    });

    it('deve rejeitar mulher homossexual quando não há preferência explícita por mulheres', () => {
      const candidate = profile('candidate-woman', 'woman', 'homosexual');
      const result = evaluateProfileCompatibility(viewer, candidate);

      expect(result.compatible).toBe(false);
      expect(result.score).toBe(0);
    });

    it('deve rejeitar homem heterossexual por incompatibilidade mútua', () => {
      const candidate = profile('candidate-straight-man', 'man', 'heterosexual');
      const result = evaluateProfileCompatibility(viewer, candidate);

      expect(result.compatible).toBe(false);
      expect(result.reason).toBe('mutual_mismatch');
    });
  });

  describe('compatibilidade entre mulheres', () => {
    const viewer = profile('viewer-woman', 'woman', 'homosexual');

    it.each([
      ['homossexual', 'homosexual'],
      ['bissexual', 'bisexual'],
      ['pansexual', 'pansexual'],
    ])('deve permitir mulher homossexual com mulher %s', (_, candidateOrientation) => {
      const candidate = profile('candidate-woman', 'woman', candidateOrientation);
      const result = evaluateProfileCompatibility(viewer, candidate);

      expect(result.compatible).toBe(true);
      expect(result.score).toBeGreaterThan(0);
      expect(result.viewerGender).toBe('woman');
      expect(result.candidateGender).toBe('woman');
    });

    it('deve rejeitar homem homossexual quando não há preferência explícita por homens', () => {
      const candidate = profile('candidate-man', 'man', 'homosexual');
      const result = evaluateProfileCompatibility(viewer, candidate);

      expect(result.compatible).toBe(false);
      expect(result.score).toBe(0);
    });
  });

  it('deve priorizar preferências explícitas sobre inferência da orientação', () => {
    const viewer = profile('viewer-explicit', 'man', 'homosexual', {
      interestedInGenders: ['woman'],
      interestedInOrientations: ['pansexual'],
    });

    const candidate = profile('candidate-explicit', 'woman', 'pansexual', {
      interestedInGenders: ['man'],
    });

    const result = evaluateProfileCompatibility(viewer, candidate);

    expect(result.compatible).toBe(true);
    expect(result.viewerUsedExplicitPreference).toBe(true);
    expect(result.reason).toBe('explicit_preference_match');
  });
});
