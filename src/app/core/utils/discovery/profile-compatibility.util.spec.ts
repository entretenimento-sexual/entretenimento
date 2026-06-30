import { describe, expect, it } from 'vitest';

import { evaluateProfileCompatibility } from './profile-compatibility.util';

const baseViewer = {
  uid: 'viewer',
  gender: 'homem',
  orientation: 'homossexual',
};

function candidate(overrides: Record<string, unknown>) {
  return {
    uid: 'candidate',
    gender: 'homem',
    orientation: 'homossexual',
    ...overrides,
  };
}

describe('evaluateProfileCompatibility', () => {
  it('accepts man to man when both are homosexual', () => {
    const result = evaluateProfileCompatibility(
      baseViewer,
      candidate({ gender: 'homem', orientation: 'homossexual' })
    );

    expect(result.compatible).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('accepts homosexual man viewing bisexual man', () => {
    const result = evaluateProfileCompatibility(
      baseViewer,
      candidate({ gender: 'homem', orientation: 'bissexual' })
    );

    expect(result.compatible).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('accepts homosexual man viewing pansexual man', () => {
    const result = evaluateProfileCompatibility(
      baseViewer,
      candidate({ gender: 'homem', orientation: 'pansexual' })
    );

    expect(result.compatible).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('rejects homosexual man viewing heterosexual man', () => {
    const result = evaluateProfileCompatibility(
      baseViewer,
      candidate({ gender: 'homem', orientation: 'heterossexual' })
    );

    expect(result.compatible).toBe(false);
    expect(result.reason).toBe('viewer_not_interested');
  });

  it('rejects homosexual man viewing bisexual woman', () => {
    const result = evaluateProfileCompatibility(
      baseViewer,
      candidate({ gender: 'mulher', orientation: 'bissexual' })
    );

    expect(result.compatible).toBe(false);
    expect(result.reason).toBe('viewer_not_interested');
  });

  it('accepts woman to woman when both are homosexual', () => {
    const result = evaluateProfileCompatibility(
      { uid: 'viewer', genero: 'mulher', orientacao: 'homossexual' },
      candidate({ genero: 'mulher', orientacao: 'homossexual' })
    );

    expect(result.compatible).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('accepts homosexual woman viewing bisexual woman', () => {
    const result = evaluateProfileCompatibility(
      { uid: 'viewer', genero: 'mulher', orientacao: 'homossexual' },
      candidate({ genero: 'mulher', orientacao: 'bissexual' })
    );

    expect(result.compatible).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('accepts localized aliases and string preferences', () => {
    const result = evaluateProfileCompatibility(
      {
        uid: 'viewer',
        genero: 'homem',
        orientacao: 'homossexual',
        preferencias: 'homens gays',
      },
      {
        uid: 'candidate',
        genero: 'homem',
        orientacao: 'homossexual',
        preferencias: 'homens gays',
      }
    );

    expect(result.compatible).toBe(true);
    expect(result.reason).toBe('explicit_preference_match');
  });
});
