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

  it('respeita a composição escolhida nos dois sentidos, mesmo sem orientação', () => {
    const viewer = profile('viewer', 'homem', 'unknown', {
      interestedInGenders: ['couple'],
      discoveryPreferences: { genderInterests: ['couple_mm'] },
    });
    const candidate = profile('candidate', 'couple', 'unknown', {
      declaredIdentityCode: 'casal-ele-ele',
      interestedInGenders: ['man'],
      discoveryPreferences: { genderInterests: ['men'] },
    });
    const otherCouple = { ...candidate, declaredIdentityCode: 'casal-ele-ela' };

    expect(evaluateProfileCompatibility(viewer, candidate).compatible).toBe(true);
    expect(evaluateProfileCompatibility(candidate, viewer).compatible).toBe(true);
    expect(evaluateProfileCompatibility(viewer, otherCouple).reason).toBe('viewer_not_interested');
    expect(evaluateProfileCompatibility(otherCouple, viewer).reason).toBe('candidate_not_interested');
  });

  it('aplica restrições da outra conta sem depender da orientação de quem consulta', () => {
    const viewer = profile('viewer', 'homem', 'unknown');
    const candidate = profile('candidate', 'mulher', 'unknown', {
      discoveryPreferences: { acceptsSingles: false },
    });

    expect(evaluateProfileCompatibility(viewer, candidate).reason).toBe('candidate_not_interested');
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
