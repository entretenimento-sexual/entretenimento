import { describe, expect, it } from 'vitest';
import type { IUserAgeEligibility } from '@core/interfaces/iuser-dados';
import {
  isCurrentAdultAccountAdmissionProjection,
  isCurrentTrustedAdultAgeProjection,
} from './trusted-adult-age-assurance.policy';

const NOW = 1_800_000_000_000;
const declared: IUserAgeEligibility = {
  status: 'SELF_DECLARED_ADULT',
  policyVersion: 1,
  source: 'SELF_DECLARATION',
  method: 'SELF_DECLARATION',
  caseId: null,
  verifiedAtMs: null,
  expiresAtMs: null,
  updatedAtMs: NOW,
};

describe('account 18+ admission projection (UX only)', () => {
  it('permite autodeclaração no onboarding sem conferir assurance forte', () => {
    expect(isCurrentAdultAccountAdmissionProjection(declared, NOW)).toBe(true);
    expect(isCurrentTrustedAdultAgeProjection(declared, NOW)).toBe(false);
  });

  it('permite verificação forte e preserva a distinção de assurance', () => {
    const verified: IUserAgeEligibility = {
      ...declared,
      status: 'VERIFIED_ADULT',
      source: 'INITIAL_VERIFICATION',
      method: 'EXTERNAL_PROVIDER',
      verifiedAtMs: NOW - 1,
    };
    expect(isCurrentAdultAccountAdmissionProjection(verified, NOW)).toBe(true);
    expect(isCurrentTrustedAdultAgeProjection(verified, NOW)).toBe(true);
  });

  it('bloqueia menoridade, revisão, expiração e declaração inconsistente', () => {
    const invalidStates: IUserAgeEligibility[] = [
      { ...declared, status: 'DENIED_UNDERAGE' },
      { ...declared, status: 'REVIEW_REQUIRED' },
      { ...declared, status: 'EXPIRED' },
      { ...declared, source: 'MIGRATION' },
      { ...declared, method: 'KYC' },
      { ...declared, policyVersion: 0 },
      { ...declared, expiresAtMs: NOW + 1 },
      { ...declared, verifiedAtMs: NOW },
    ];
    for (const state of invalidStates) {
      expect(isCurrentAdultAccountAdmissionProjection(state, NOW)).toBe(false);
    }
  });
});
