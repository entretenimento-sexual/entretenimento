import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateRecipientFinancialCompliance,
  requiresRecipientFinancialOnboarding,
} from './financial-compliance.policy';

describe('financial compliance policy', () => {
  it('não exige KYC financeiro adicional para comprador da assinatura da plataforma', () => {
    assert.equal(
      requiresRecipientFinancialOnboarding('platform_subscription'),
      false
    );
    assert.deepEqual(
      evaluateRecipientFinancialCompliance({
        scope: 'platform_subscription',
      }),
      {
        allowed: true,
        requiresRecipientKyc: false,
        reason: 'PLATFORM_SUBSCRIPTION_BUYER_FLOW',
      }
    );
  });

  it('exige onboarding financeiro para qualquer escopo com recebedor', () => {
    for (const scope of [
      'creator_subscription',
      'tip',
      'paid_media',
      'paid_live',
    ] as const) {
      assert.equal(requiresRecipientFinancialOnboarding(scope), true);
      assert.equal(
        evaluateRecipientFinancialCompliance({ scope }).allowed,
        false
      );
    }
  });

  it('libera recebedor somente com KYC, AML e conta de pagamento válidos', () => {
    assert.deepEqual(
      evaluateRecipientFinancialCompliance({
        scope: 'tip',
        sellerUid: 'creator-1',
        profile: {
          creatorEnabled: true,
          emailVerified: true,
          monetizationTermsAccepted: true,
          kycStatus: 'VERIFIED',
          amlStatus: 'CLEAR',
          payoutAccountStatus: 'ACTIVE',
          newPaymentsPaused: false,
        },
      }),
      {
        allowed: true,
        requiresRecipientKyc: true,
        reason: 'ELIGIBLE',
      }
    );
  });

  it('pausa novos pagamentos após falha operacional de saque', () => {
    assert.deepEqual(
      evaluateRecipientFinancialCompliance({
        scope: 'tip',
        sellerUid: 'creator-1',
        profile: {
          creatorEnabled: true,
          emailVerified: true,
          monetizationTermsAccepted: true,
          kycStatus: 'VERIFIED',
          amlStatus: 'CLEAR',
          payoutAccountStatus: 'ACTIVE',
          newPaymentsPaused: true,
        },
      }),
      {
        allowed: false,
        requiresRecipientKyc: true,
        reason: 'PAYOUT_FAILURE_PAUSE',
      }
    );
  });

  it('bloqueia recebimento durante revisão ou restrição AML', () => {
    for (const amlStatus of ['UNDER_REVIEW', 'RESTRICTED'] as const) {
      const result = evaluateRecipientFinancialCompliance({
        scope: 'paid_media',
        sellerUid: 'creator-1',
        profile: {
          creatorEnabled: true,
          emailVerified: true,
          monetizationTermsAccepted: true,
          kycStatus: 'VERIFIED',
          amlStatus,
          payoutAccountStatus: 'ACTIVE',
          newPaymentsPaused: false,
        },
      });

      assert.equal(result.allowed, false);
      assert.equal(
        result.reason,
        amlStatus === 'RESTRICTED'
          ? 'AML_RESTRICTED'
          : 'AML_REVIEW_PENDING'
      );
    }
  });
});
