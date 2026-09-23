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
    ageReverification: { status: 'NONE' },
  };

  const eligibleAge = {
    uid: 'user-1',
    status: 'VERIFIED_ADULT',
    policyVersion: 1,
    source: 'AGE_REVERIFICATION',
    method: 'MANUAL_REVIEW',
    caseId: 'case-1',
    verifiedAtMs: Date.now() - 1_000,
    expiresAtMs: null,
  };

  function assertBlockedWithReason(
    user: Parameters<typeof assertPublicMediaConsumptionAccessData>[0],
    age: unknown,
    expectedReason: PublicMediaConsumptionAccessReason
  ): void {
    assert.throws(
      () => assertPublicMediaConsumptionAccessData(
        user,
        age,
        'user-1'
      ),
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

  it('permite conta adulta com termos e consentimento vigentes', () => {
    assert.doesNotThrow(() =>
      assertPublicMediaConsumptionAccessData(
        eligibleUser,
        eligibleAge,
        'user-1'
      )
    );
  });

  it('bloqueia lifecycle restrito ou suspensão', () => {
    assertBlockedWithReason(
      {
        ...eligibleUser,
        accountStatus: 'pending_deletion',
      },
      eligibleAge,
      'ACCOUNT_UNAVAILABLE'
    );
    assertBlockedWithReason(
      {
        ...eligibleUser,
        suspended: true,
      },
      eligibleAge,
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
      eligibleAge,
      'TERMS_REQUIRED'
    );
  });

  it('bloqueia consentimento adulto ausente ou desatualizado', () => {
    assertBlockedWithReason(
      {
        ...eligibleUser,
        adultConsent: null,
      },
      eligibleAge,
      'ADULT_CONSENT_REQUIRED'
    );
    assertBlockedWithReason(
      {
        ...eligibleUser,
        adultConsent: { accepted: true, version: 'legacy' },
      },
      eligibleAge,
      'ADULT_CONSENT_REQUIRED'
    );
  });

  it('bloqueia ausência de verificação etária canônica', () => {
    assertBlockedWithReason(
      eligibleUser,
      null,
      'AGE_VERIFICATION_REQUIRED'
    );
  });

  it('bloqueia decisão canônica de menoridade', () => {
    assertBlockedWithReason(
      eligibleUser,
      {
        ...eligibleAge,
        status: 'DENIED_UNDERAGE',
        verifiedAtMs: null,
      },
      'AGE_ACCESS_DENIED'
    );
  });

  it('bloqueia estados pendentes de revalidação etária', () => {
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
        eligibleAge,
        'AGE_REVERIFICATION_REQUIRED'
      );
    }
  });
});
