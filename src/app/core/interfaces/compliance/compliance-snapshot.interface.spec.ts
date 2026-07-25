import {
  createUnavailableComplianceSnapshot,
  normalizeComplianceSnapshot,
} from './compliance-snapshot.interface';

describe('compliance snapshot contract', () => {
  it('deve criar fallback indisponível e inelegível', () => {
    const snapshot = createUnavailableComplianceSnapshot();

    expect(snapshot.available).toBe(false);
    expect(snapshot.payoutEligibility.eligible).toBe(false);
    expect(snapshot.payoutEligibility.reasons).toEqual([
      'compliance_snapshot_unavailable',
    ]);
  });

  it('deve preservar snapshot válido e elegível emitido pelo backend', () => {
    const snapshot = normalizeComplianceSnapshot({
      available: true,
      adultConsentStatus: 'accepted',
      ageVerificationStatus: 'approved',
      ageVerifiedAt: 1_700_000_000_000,
      identityVerificationStatus: 'approved',
      identityVerificationProvider: ' PROVIDER_1 ',
      identityVerificationUpdatedAt: 1_700_000_000_100,
      payoutAccountStatus: 'active',
      amlRiskTier: 'low',
      lastRiskReviewAt: 1_700_000_000_200,
      payoutEligibility: {
        eligible: true,
        reasons: [],
      },
      generatedAt: 1_700_000_000_300,
    });

    expect(snapshot.available).toBe(true);
    expect(snapshot.identityVerificationProvider).toBe('provider_1');
    expect(snapshot.payoutEligibility).toEqual({
      eligible: true,
      reasons: [],
    });
  });

  it('deve falhar fechado quando o payload não for um objeto', () => {
    const snapshot = normalizeComplianceSnapshot('invalid');

    expect(snapshot).toEqual(createUnavailableComplianceSnapshot());
  });

  it('não deve aceitar elegibilidade incompatível com os estados sanitizados', () => {
    const snapshot = normalizeComplianceSnapshot({
      available: true,
      adultConsentStatus: 'accepted',
      ageVerificationStatus: 'approved',
      identityVerificationStatus: 'pending',
      payoutAccountStatus: 'active',
      amlRiskTier: 'medium',
      payoutEligibility: {
        eligible: true,
        reasons: [],
      },
      generatedAt: 1_700_000_000_000,
    });

    expect(snapshot.payoutEligibility.eligible).toBe(false);
    expect(snapshot.payoutEligibility.reasons).toEqual([
      'identity_verification_required',
      'aml_review_required',
    ]);
  });

  it('deve descartar valores e motivos desconhecidos sem liberar saque', () => {
    const snapshot = normalizeComplianceSnapshot({
      available: true,
      adultConsentStatus: 'unknown',
      ageVerificationStatus: 'approved-by-client',
      identityVerificationStatus: 'approved',
      identityVerificationProvider: 'provider com espaço',
      payoutAccountStatus: 'enabled',
      amlRiskTier: 'safe',
      payoutEligibility: {
        eligible: true,
        reasons: ['unknown_reason', 'account_locked', 'account_locked'],
      },
      generatedAt: Number.NaN,
    });

    expect(snapshot.identityVerificationProvider).toBeNull();
    expect(snapshot.generatedAt).toBeNull();
    expect(snapshot.payoutEligibility.eligible).toBe(false);
    expect(snapshot.payoutEligibility.reasons).toEqual([
      'account_locked',
      'adult_consent_required',
      'age_verification_required',
      'payout_account_required',
      'aml_review_required',
    ]);
  });
});
