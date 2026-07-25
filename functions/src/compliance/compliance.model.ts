// functions/src/compliance/compliance.model.ts
// -----------------------------------------------------------------------------
// COMPLIANCE DOMAIN CONTRACT
// -----------------------------------------------------------------------------
//
// Contrato interno e projeção mínima do estado KYC/AML.
//
// Princípios:
// - o backend é a única autoridade para elegibilidade de saque;
// - ausência ou valor desconhecido falha de forma fechada;
// - documentos, biometria, CPF e payloads de provedor nunca fazem parte deste
//   contrato;
// - o frontend recebe apenas estados sanitizados e motivos operacionais.

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

export const ACCOUNT_STATUS_VALUES = [
  'active',
  'self_suspended',
  'moderation_suspended',
  'pending_deletion',
  'deleted',
] as const;

export type ComplianceAccountStatus =
  (typeof ACCOUNT_STATUS_VALUES)[number];

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

export interface PayoutEligibility {
  eligible: boolean;
  reasons: PayoutEligibilityReason[];
}

export interface ComplianceEligibilityInput {
  adultConsentAccepted: boolean;
  ageVerificationStatus: AgeVerificationStatus;
  identityVerificationStatus: IdentityVerificationStatus;
  payoutAccountStatus: PayoutAccountStatus;
  amlRiskTier: AmlRiskTier | null;
  accountStatus: ComplianceAccountStatus;
  accountLocked: boolean;
  interactionBlocked: boolean;
}

export interface MyComplianceSnapshot {
  available: true;
  adultConsentStatus: AdultConsentStatus;
  ageVerificationStatus: AgeVerificationStatus;
  ageVerifiedAt: number | null;
  identityVerificationStatus: IdentityVerificationStatus;
  identityVerificationProvider: string | null;
  identityVerificationUpdatedAt: number | null;
  payoutAccountStatus: PayoutAccountStatus;
  amlRiskTier: AmlRiskTier | null;
  lastRiskReviewAt: number | null;
  payoutEligibility: PayoutEligibility;
  generatedAt: number;
}

/**
 * Deriva elegibilidade sem aceitar decisões enviadas pelo navegador.
 *
 * Política inicial conservadora:
 * - AML `low` é o único tier automaticamente elegível;
 * - `medium` e `high` exigem revisão antes de qualquer saque;
 * - `blocked` impede explicitamente a operação;
 * - estados ausentes são normalizados antes desta função e permanecem
 *   inelegíveis.
 */
export function derivePayoutEligibility(
  input: ComplianceEligibilityInput
): PayoutEligibility {
  const reasons: PayoutEligibilityReason[] = [];

  if (!input.adultConsentAccepted) {
    reasons.push('adult_consent_required');
  }

  if (input.ageVerificationStatus !== 'approved') {
    reasons.push('age_verification_required');
  }

  if (input.identityVerificationStatus !== 'approved') {
    reasons.push('identity_verification_required');
  }

  if (input.payoutAccountStatus !== 'active') {
    reasons.push('payout_account_required');
  }

  if (input.amlRiskTier === 'blocked') {
    reasons.push('aml_risk_blocked');
  } else if (input.amlRiskTier !== 'low') {
    reasons.push('aml_review_required');
  }

  if (input.accountStatus !== 'active') {
    reasons.push('account_not_active');
  }

  if (input.accountLocked) {
    reasons.push('account_locked');
  }

  if (input.interactionBlocked) {
    reasons.push('account_interactions_blocked');
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}
