import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  derivePayoutEligibility,
  normalizeComplianceAccountStatus,
} from './compliance.model';

describe('derivePayoutEligibility', () => {
  const eligibleInput = {
    adultConsentAccepted: true,
    ageVerificationStatus: 'approved' as const,
    identityVerificationStatus: 'approved' as const,
    payoutAccountStatus: 'active' as const,
    amlRiskTier: 'low' as const,
    accountStatus: 'active' as const,
    accountLocked: false,
    interactionBlocked: false,
  };

  it('permite somente quando todos os controles estiverem adequados', () => {
    assert.deepEqual(derivePayoutEligibility(eligibleInput), {
      eligible: true,
      reasons: [],
    });
  });

  it('acumula todos os motivos operacionais quando os controles falham', () => {
    assert.deepEqual(
      derivePayoutEligibility({
        adultConsentAccepted: false,
        ageVerificationStatus: 'pending',
        identityVerificationStatus: 'needs_action',
        payoutAccountStatus: 'restricted',
        amlRiskTier: null,
        accountStatus: 'moderation_suspended',
        accountLocked: true,
        interactionBlocked: true,
      }),
      {
        eligible: false,
        reasons: [
          'adult_consent_required',
          'age_verification_required',
          'identity_verification_required',
          'payout_account_required',
          'aml_review_required',
          'account_not_active',
          'account_locked',
          'account_interactions_blocked',
        ],
      }
    );
  });

  it('distingue risco AML bloqueado de revisão pendente', () => {
    const blocked = derivePayoutEligibility({
      ...eligibleInput,
      amlRiskTier: 'blocked',
    });
    const reviewRequired = derivePayoutEligibility({
      ...eligibleInput,
      amlRiskTier: 'medium',
    });

    assert.deepEqual(blocked.reasons, ['aml_risk_blocked']);
    assert.deepEqual(reviewRequired.reasons, ['aml_review_required']);
  });
});

describe('normalizeComplianceAccountStatus', () => {
  const activeLifecycle = {
    explicitStatus: 'active',
    suspended: false,
    loginAllowed: true,
    deletionRequested: false,
    deleted: false,
  };

  it('preserva conta ativa consistente', () => {
    assert.equal(
      normalizeComplianceAccountStatus(activeLifecycle),
      'active'
    );
  });

  it('faz suspensão legada prevalecer sobre status ativo', () => {
    assert.equal(
      normalizeComplianceAccountStatus({
        ...activeLifecycle,
        suspended: true,
      }),
      'moderation_suspended'
    );
  });

  it('faz bloqueio de login prevalecer sobre status ativo', () => {
    assert.equal(
      normalizeComplianceAccountStatus({
        ...activeLifecycle,
        loginAllowed: false,
      }),
      'moderation_suspended'
    );
  });

  it('prioriza exclusão concluída e solicitada sobre estados permissivos', () => {
    assert.equal(
      normalizeComplianceAccountStatus({
        ...activeLifecycle,
        deletionRequested: true,
      }),
      'pending_deletion'
    );

    assert.equal(
      normalizeComplianceAccountStatus({
        ...activeLifecycle,
        deletionRequested: true,
        deleted: true,
      }),
      'deleted'
    );
  });

  it('preserva suspensão voluntária explícita', () => {
    assert.equal(
      normalizeComplianceAccountStatus({
        ...activeLifecycle,
        explicitStatus: 'self_suspended',
      }),
      'self_suspended'
    );
  });
});
