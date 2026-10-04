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
    interactionBlocked: false,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
    adultConsent: {
      accepted: true,
      version: 'v1',
    },
  };

  function assertBlockedWithReason(
    user: Parameters<typeof assertPublicMediaConsumptionAccessData>[0],
    expectedReason: PublicMediaConsumptionAccessReason
  ): void {
    assert.throws(
      () => assertPublicMediaConsumptionAccessData(user),
      (error: unknown) => {
        assert.ok(error instanceof HttpsError);
        assert.equal(
          (error.details as { reason?: unknown } | undefined)?.reason,
          expectedReason
        );
        return true;
      }
    );
  }

  it('permite conta ativa com termos e consentimento vigentes', () => {
    assert.doesNotThrow(() =>
      assertPublicMediaConsumptionAccessData(eligibleUser)
    );
  });

  it('não cria gate de Media a partir de reverificação etária', () => {
    assert.doesNotThrow(() =>
      assertPublicMediaConsumptionAccessData({
        ...eligibleUser,
        ageReverification: { status: 'REQUIRED' },
      } as typeof eligibleUser & {
        ageReverification: { status: string };
      })
    );
  });

  it('bloqueia lifecycle restrito ou suspensão', () => {
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

  it('bloqueia termos desatualizados', () => {
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

  it('bloqueia consentimento adulto ausente ou desatualizado', () => {
    assertBlockedWithReason(
      {
        ...eligibleUser,
        adultConsent: null,
      },
      'ADULT_CONSENT_REQUIRED'
    );
    assertBlockedWithReason(
      {
        ...eligibleUser,
        adultConsent: { accepted: true, version: 'legacy' },
      },
      'ADULT_CONSENT_REQUIRED'
    );
  });
});
