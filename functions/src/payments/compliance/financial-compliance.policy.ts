import type { BillingScope } from '../domain/billing.model';

export type RecipientKycStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED';

export type RecipientAmlStatus =
  | 'CLEAR'
  | 'UNDER_REVIEW'
  | 'RESTRICTED';

export type PayoutAccountStatus =
  | 'NOT_CONFIGURED'
  | 'PENDING'
  | 'ACTIVE'
  | 'FAILED'
  | 'BLOCKED';

export interface RecipientFinancialComplianceProfile {
  creatorEnabled?: boolean | null;
  emailVerified?: boolean | null;
  monetizationTermsAccepted?: boolean | null;
  kycStatus?: RecipientKycStatus | null;
  amlStatus?: RecipientAmlStatus | null;
  payoutAccountStatus?: PayoutAccountStatus | null;
  newPaymentsPaused?: boolean | null;
}

export type FinancialComplianceReason =
  | 'PLATFORM_SUBSCRIPTION_BUYER_FLOW'
  | 'RECIPIENT_REQUIRED'
  | 'CREATOR_NOT_ENABLED'
  | 'EMAIL_NOT_VERIFIED'
  | 'MONETIZATION_TERMS_REQUIRED'
  | 'KYC_REQUIRED'
  | 'AML_REVIEW_PENDING'
  | 'AML_RESTRICTED'
  | 'PAYOUT_ACCOUNT_REQUIRED'
  | 'PAYOUT_FAILURE_PAUSE'
  | 'ELIGIBLE';

export interface FinancialComplianceDecision {
  allowed: boolean;
  requiresRecipientKyc: boolean;
  reason: FinancialComplianceReason;
}

const RECIPIENT_MONETIZATION_SCOPES: readonly BillingScope[] = [
  'creator_subscription',
  'tip',
  'paid_media',
  'paid_live',
];

/**
 * Comprar uma assinatura da própria plataforma não exige KYC financeiro
 * adicional no produto. Antifraude, autenticação do pagador e eventuais
 * diligências seguem no provedor de pagamento e podem ser acionados por risco.
 */
export function requiresRecipientFinancialOnboarding(
  scope: BillingScope
): boolean {
  return RECIPIENT_MONETIZATION_SCOPES.includes(scope);
}

/**
 * A diligência financeira é proporcional ao risco e aplicada somente a quem
 * recebe valores. Usuários que apenas navegam ou compram não passam por este
 * onboarding por padrão.
 */
export function evaluateRecipientFinancialCompliance(params: {
  scope: BillingScope;
  sellerUid?: string | null;
  profile?: RecipientFinancialComplianceProfile | null;
}): FinancialComplianceDecision {
  if (!requiresRecipientFinancialOnboarding(params.scope)) {
    return {
      allowed: true,
      requiresRecipientKyc: false,
      reason: 'PLATFORM_SUBSCRIPTION_BUYER_FLOW',
    };
  }

  const sellerUid = String(params.sellerUid ?? '').trim();
  if (!sellerUid) {
    return {
      allowed: false,
      requiresRecipientKyc: true,
      reason: 'RECIPIENT_REQUIRED',
    };
  }

  const profile = params.profile;
  if (profile?.creatorEnabled !== true) {
    return {
      allowed: false,
      requiresRecipientKyc: true,
      reason: 'CREATOR_NOT_ENABLED',
    };
  }

  if (profile.emailVerified !== true) {
    return {
      allowed: false,
      requiresRecipientKyc: true,
      reason: 'EMAIL_NOT_VERIFIED',
    };
  }

  if (profile.monetizationTermsAccepted !== true) {
    return {
      allowed: false,
      requiresRecipientKyc: true,
      reason: 'MONETIZATION_TERMS_REQUIRED',
    };
  }

  if (profile.kycStatus !== 'VERIFIED') {
    return {
      allowed: false,
      requiresRecipientKyc: true,
      reason: 'KYC_REQUIRED',
    };
  }

  if (profile.amlStatus === 'RESTRICTED') {
    return {
      allowed: false,
      requiresRecipientKyc: true,
      reason: 'AML_RESTRICTED',
    };
  }

  if (profile.amlStatus !== 'CLEAR') {
    return {
      allowed: false,
      requiresRecipientKyc: true,
      reason: 'AML_REVIEW_PENDING',
    };
  }

  if (profile.payoutAccountStatus !== 'ACTIVE') {
    return {
      allowed: false,
      requiresRecipientKyc: true,
      reason: 'PAYOUT_ACCOUNT_REQUIRED',
    };
  }

  if (profile.newPaymentsPaused === true) {
    return {
      allowed: false,
      requiresRecipientKyc: true,
      reason: 'PAYOUT_FAILURE_PAUSE',
    };
  }

  return {
    allowed: true,
    requiresRecipientKyc: true,
    reason: 'ELIGIBLE',
  };
}
