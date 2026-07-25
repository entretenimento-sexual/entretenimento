// src/app/core/interfaces/compliance/compliance-snapshot.interface.ts
// -----------------------------------------------------------------------------
// COMPLIANCE SNAPSHOT CONTRACT
// -----------------------------------------------------------------------------
//
// Projeção mínima consumida pelo Angular. O navegador nunca decide KYC, AML ou
// elegibilidade de saque; apenas normaliza a resposta do backend de forma
// fail-closed para apresentação e guards futuros.

export const AGE_VERIFICATION_STATUS_VALUES = [
  'not_started',
  'pending',
  'approved',
  'rejected',
  'expired',
] as const;

export type AgeVerificationStatus =
  (typeof AGE_VERIFICATION_STATUS_VALUES)[number];

export const IDENTITY_VERIFICATION_STATUS_VALUES = [
  'not_started',
  'pending',
  'needs_action',
  'approved',
  'rejected',
  'expired',
] as const;

export type IdentityVerificationStatus =
  (typeof IDENTITY_VERIFICATION_STATUS_VALUES)[number];

export const PAYOUT_ACCOUNT_STATUS_VALUES = [
  'not_connected',
  'pending',
  'active',
  'restricted',
  'disabled',
] as const;

export type PayoutAccountStatus =
  (typeof PAYOUT_ACCOUNT_STATUS_VALUES)[number];

export const AML_RISK_TIER_VALUES = [
  'low',
  'medium',
  'high',
  'blocked',
] as const;

export type AmlRiskTier = (typeof AML_RISK_TIER_VALUES)[number];

export type AdultConsentStatus = 'not_accepted' | 'accepted';

export const PAYOUT_ELIGIBILITY_REASON_VALUES = [
  'adult_consent_required',
  'age_verification_required',
  'identity_verification_required',
  'payout_account_required',
  'aml_review_required',
  'aml_risk_blocked',
  'account_not_active',
  'account_locked',
  'account_interactions_blocked',
  'compliance_snapshot_unavailable',
] as const;

export type PayoutEligibilityReason =
  (typeof PAYOUT_ELIGIBILITY_REASON_VALUES)[number];

export interface PayoutEligibilitySnapshot {
  eligible: boolean;
  reasons: PayoutEligibilityReason[];
}

export interface ComplianceSnapshot {
  available: boolean;
  adultConsentStatus: AdultConsentStatus;
  ageVerificationStatus: AgeVerificationStatus;
  ageVerifiedAt: number | null;
  identityVerificationStatus: IdentityVerificationStatus;
  identityVerificationProvider: string | null;
  identityVerificationUpdatedAt: number | null;
  payoutAccountStatus: PayoutAccountStatus;
  amlRiskTier: AmlRiskTier | null;
  lastRiskReviewAt: number | null;
  payoutEligibility: PayoutEligibilitySnapshot;
  generatedAt: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isAllowedValue<T extends string>(
  value: unknown,
  allowedValues: readonly T[]
): value is T {
  return typeof value === 'string' && allowedValues.includes(value as T);
}

function toEpochOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : null;
}

function normalizeProvider(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const provider = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,64}$/.test(provider) ? provider : null;
}

function normalizeReasons(value: unknown): PayoutEligibilityReason[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value.filter((reason): reason is PayoutEligibilityReason =>
        isAllowedValue(reason, PAYOUT_ELIGIBILITY_REASON_VALUES)
      )
    )
  );
}

function deriveFailClosedReasons(
  snapshot: Omit<ComplianceSnapshot, 'payoutEligibility'>
): PayoutEligibilityReason[] {
  if (!snapshot.available) {
    return ['compliance_snapshot_unavailable'];
  }

  const reasons: PayoutEligibilityReason[] = [];

  if (snapshot.adultConsentStatus !== 'accepted') {
    reasons.push('adult_consent_required');
  }

  if (snapshot.ageVerificationStatus !== 'approved') {
    reasons.push('age_verification_required');
  }

  if (snapshot.identityVerificationStatus !== 'approved') {
    reasons.push('identity_verification_required');
  }

  if (snapshot.payoutAccountStatus !== 'active') {
    reasons.push('payout_account_required');
  }

  if (snapshot.amlRiskTier === 'blocked') {
    reasons.push('aml_risk_blocked');
  } else if (snapshot.amlRiskTier !== 'low') {
    reasons.push('aml_review_required');
  }

  return reasons;
}

export function createUnavailableComplianceSnapshot(): ComplianceSnapshot {
  return {
    available: false,
    adultConsentStatus: 'not_accepted',
    ageVerificationStatus: 'not_started',
    ageVerifiedAt: null,
    identityVerificationStatus: 'not_started',
    identityVerificationProvider: null,
    identityVerificationUpdatedAt: null,
    payoutAccountStatus: 'not_connected',
    amlRiskTier: null,
    lastRiskReviewAt: null,
    payoutEligibility: {
      eligible: false,
      reasons: ['compliance_snapshot_unavailable'],
    },
    generatedAt: null,
  };
}

export function normalizeComplianceSnapshot(
  value: unknown
): ComplianceSnapshot {
  if (!isRecord(value)) {
    return createUnavailableComplianceSnapshot();
  }

  const available = value['available'] === true;
  const adultConsentStatus: AdultConsentStatus =
    value['adultConsentStatus'] === 'accepted'
      ? 'accepted'
      : 'not_accepted';
  const ageVerificationStatus: AgeVerificationStatus = isAllowedValue(
    value['ageVerificationStatus'],
    AGE_VERIFICATION_STATUS_VALUES
  )
    ? value['ageVerificationStatus']
    : 'not_started';
  const identityVerificationStatus: IdentityVerificationStatus =
    isAllowedValue(
      value['identityVerificationStatus'],
      IDENTITY_VERIFICATION_STATUS_VALUES
    )
      ? value['identityVerificationStatus']
      : 'not_started';
  const payoutAccountStatus: PayoutAccountStatus = isAllowedValue(
    value['payoutAccountStatus'],
    PAYOUT_ACCOUNT_STATUS_VALUES
  )
    ? value['payoutAccountStatus']
    : 'not_connected';
  const amlRiskTier: AmlRiskTier | null = isAllowedValue(
    value['amlRiskTier'],
    AML_RISK_TIER_VALUES
  )
    ? value['amlRiskTier']
    : null;

  const baseSnapshot: Omit<ComplianceSnapshot, 'payoutEligibility'> = {
    available,
    adultConsentStatus,
    ageVerificationStatus,
    ageVerifiedAt: toEpochOrNull(value['ageVerifiedAt']),
    identityVerificationStatus,
    identityVerificationProvider: normalizeProvider(
      value['identityVerificationProvider']
    ),
    identityVerificationUpdatedAt: toEpochOrNull(
      value['identityVerificationUpdatedAt']
    ),
    payoutAccountStatus,
    amlRiskTier,
    lastRiskReviewAt: toEpochOrNull(value['lastRiskReviewAt']),
    generatedAt: toEpochOrNull(value['generatedAt']),
  };

  const eligibilitySource = isRecord(value['payoutEligibility'])
    ? value['payoutEligibility']
    : {};
  const serverReasons = normalizeReasons(eligibilitySource['reasons']);
  const derivedReasons = deriveFailClosedReasons(baseSnapshot);
  const reasons = Array.from(new Set([...serverReasons, ...derivedReasons]));
  const eligible =
    available &&
    eligibilitySource['eligible'] === true &&
    reasons.length === 0;

  return {
    ...baseSnapshot,
    payoutEligibility: {
      eligible,
      reasons,
    },
  };
}
