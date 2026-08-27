import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertPublicMediaConsumptionAccessData,
  type PublicMediaConsumptionAccessReason,
} from './public-media-consumption-access.policy';

describe('public media consumption access policy', () => {
  const eligibleUser = {
    accountStatus: 'active',
    suspended: false,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
    initialAdultConsentRequired: false,
    ageReverification: { status: 'NONE' },
  };

  function assertBlockedWithReason(
    user: Parameters<typeof assertPublicMediaConsumptionAccessData>[0],
    expectedReason: PublicMediaConsumptionAccessReason
  ): void {
    assert.throws(
      () => assertPublicMediaConsumptionAccessData(user),
      (error: unknown) => {
        assert.ok(error instanceof HttpsError);
        assert.equal(error.code, 'failed-precondition');
        assert.equal(
          (error.details as { reason?: unknown } | undefined)?.reason,
          expectedReason
        );
        return true;
      }
    );
  }

  it('permite conta ativa com termos vigentes e sem reverificação pendente', () => {
    assert.doesNotThrow(() =>
      assertPublicMediaConsumptionAccessData(eligibleUser)
    );
  });

  it('permite consentimento adulto vigente quando ele é obrigatório', () => {
    assert.doesNotThrow(() =>
      assertPublicMediaConsumptionAccessData({
        ...eligibleUser,
        initialAdultConsentRequired: true,
        adultConsent: { accepted: true, version: 'v1' },
      })
    );
  });

  it('bloqueia lifecycle restrito ou suspensão legada com motivo estruturado', () => {
    assertBlockedWithReason(
      {
        ...eligibleUser,
        accountStatus: 'pending_deletion',
      },
      'ACCOUNT_UNAVAILABLE'
    );
    assertBlockedWithReason(
      {
        ...eligibleUser,
        suspended: true,
      },
      'ACCOUNT_UNAVAILABLE'
    );
  });

  it('bloqueia termos desatualizados com motivo estruturado', () => {
    assertBlockedWithReason(
      {
        ...eligibleUser,
        acceptedTerms: {
          accepted: true,
          version: 'v2',
          acknowledgedPrivacyNotice: true,
        },
      },
      'TERMS_REQUIRED'
    );
  });

  it('bloqueia consentimento adulto ausente ou desatualizado quando obrigatório', () => {
    assertBlockedWithReason(
      {
        ...eligibleUser,
        initialAdultConsentRequired: true,
        adultConsent: null,
      },
      'ADULT_CONSENT_REQUIRED'
    );
    assertBlockedWithReason(
      {
        ...eligibleUser,
        initialAdultConsentRequired: true,
        adultConsent: { accepted: true, version: 'legacy' },
      },
      'ADULT_CONSENT_REQUIRED'
    );
  });

  it('bloqueia estados pendentes de revalidação etária com motivo estruturado', () => {
    for (const status of [
      'REQUIRED',
      'SUBMITTED',
      'UNDER_REVIEW',
      'EXPIRED',
    ]) {
      assertBlockedWithReason(
        {
          ...eligibleUser,
          ageReverification: { status },
        },
        'AGE_REVERIFICATION_REQUIRED'
      );
    }
  });
});
