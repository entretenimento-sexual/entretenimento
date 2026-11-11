import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  assertMediaAuthoringEligibilityData,
} from './media-authoring-eligibility.service';

describe('media authoring eligibility', () => {
  const eligibleUser = {
    accountStatus: 'active',
    suspended: false,
    interactionBlocked: false,
    acceptedTerms: {
      accepted: true,
      version: 'v3',
      acknowledgedPrivacyNotice: true,
    },
  };

  it('permite autoria para conta ativa sem depender do assurance etário', () => {
    for (const legacyAgeProjection of [
      null,
      {
        status: 'SELF_DECLARED_ADULT',
        policyVersion: 1,
      },
      {
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
      },
      {
        status: 'EXPIRED',
        policyVersion: 1,
      },
    ]) {
      const userWithLegacyProjection = {
        ...eligibleUser,
        ageEligibility: legacyAgeProjection,
      };

      assert.deepEqual(
        assertMediaAuthoringEligibilityData(userWithLegacyProjection),
        { allowed: true }
      );
    }
  });

  it('não transforma reverificação etária em gate local de Media', () => {
    const userWithReverificationProjection = {
      ...eligibleUser,
      ageReverification: { status: 'REQUIRED' },
    };

    assert.doesNotThrow(() =>
      assertMediaAuthoringEligibilityData(userWithReverificationProjection)
    );
  });

  it('permite autoria sem consentimento v1, inclusive histórico recusado', () => {
    const legacyStates = [
      undefined,
      null,
      { accepted: false, version: 'v1' },
      { accepted: true, version: 'v1' },
    ];

    for (const adultConsent of legacyStates) {
      const user = {
        ...eligibleUser,
        initialAdultConsentRequired: true,
        adultConsent,
      };
      assert.deepEqual(assertMediaAuthoringEligibilityData(user), { allowed: true });
    }
  });

  it('mantém bloqueios materiais de lifecycle e moderação', () => {
    for (const user of [
      { ...eligibleUser, accountLocked: true },
      { ...eligibleUser, loginAllowed: false },
      {
        ...eligibleUser,
        moderationAutomationHold: { active: true, expiresAtMs: Date.now() + 60_000 },
      },
    ]) {
      assert.throws(() => assertMediaAuthoringEligibilityData(user), HttpsError);
    }
  });

  it('bloqueia quando o lifecycle da conta não autoriza interação', () => {
    for (const user of [
      { ...eligibleUser, suspended: true },
      { ...eligibleUser, interactionBlocked: true },
      { ...eligibleUser, accountStatus: 'pending_deletion' },
    ]) {
      assert.throws(
        () => assertMediaAuthoringEligibilityData(user),
        HttpsError
      );
    }
  });

  it('bloqueia termos atuais ausentes ou inválidos', () => {
    assert.throws(
      () => assertMediaAuthoringEligibilityData({ ...eligibleUser, acceptedTerms: null }),
      HttpsError
    );
    assert.throws(
      () => assertMediaAuthoringEligibilityData({
        ...eligibleUser,
        acceptedTerms: { accepted: false, version: 'v3', acknowledgedPrivacyNotice: true },
      }),
      HttpsError
    );
    assert.throws(
      () => assertMediaAuthoringEligibilityData(
        {
          ...eligibleUser,
          acceptedTerms: {
            accepted: true,
            version: 'legacy',
            acknowledgedPrivacyNotice: true,
          },
        }
      ),
      HttpsError
    );

  });
});
