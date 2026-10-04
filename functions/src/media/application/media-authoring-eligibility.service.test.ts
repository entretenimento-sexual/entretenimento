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
    adultConsent: {
      accepted: true,
      version: 'v1',
    },
  };

  it('permite autoria para conta ativa sem depender do assurance etário', () => {
    for (const ageRecord of [
      null,
      {
        uid: 'user-1',
        status: 'SELF_DECLARED_ADULT',
        policyVersion: 1,
      },
      {
        uid: 'user-1',
        status: 'VERIFIED_ADULT',
        policyVersion: 1,
      },
      {
        uid: 'user-1',
        status: 'EXPIRED',
        policyVersion: 1,
      },
    ]) {
      assert.deepEqual(
        assertMediaAuthoringEligibilityData(
          eligibleUser,
          ageRecord,
          'user-1'
        ),
        { allowed: true }
      );
    }
  });

  it('não transforma reverificação etária em gate local de Media', () => {
    assert.doesNotThrow(() =>
      assertMediaAuthoringEligibilityData(
        {
          ...eligibleUser,
          ageReverification: { status: 'REQUIRED' },
        } as typeof eligibleUser & {
          ageReverification: { status: string };
        },
        null,
        'user-1'
      )
    );
  });

  it('bloqueia quando o lifecycle da conta não autoriza interação', () => {
    for (const user of [
      { ...eligibleUser, suspended: true },
      { ...eligibleUser, interactionBlocked: true },
      { ...eligibleUser, accountStatus: 'pending_deletion' },
    ]) {
      assert.throws(
        () => assertMediaAuthoringEligibilityData(user, null, 'user-1'),
        HttpsError
      );
    }
  });

  it('bloqueia termos ou consentimento adulto ausentes', () => {
    assert.throws(
      () => assertMediaAuthoringEligibilityData(
        {
          ...eligibleUser,
          acceptedTerms: {
            accepted: true,
            version: 'legacy',
            acknowledgedPrivacyNotice: true,
          },
        },
        null,
        'user-1'
      ),
      HttpsError
    );

    assert.throws(
      () => assertMediaAuthoringEligibilityData(
        {
          ...eligibleUser,
          adultConsent: null,
        },
        null,
        'user-1'
      ),
      HttpsError
    );
  });
});
