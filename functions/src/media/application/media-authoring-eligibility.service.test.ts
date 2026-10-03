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
    ageReverification: { status: 'NONE' },
  };

  const selfDeclaredAdult = {
    uid: 'user-1',
    status: 'SELF_DECLARED_ADULT',
    policyVersion: 1,
    source: 'SELF_DECLARATION',
    method: 'SELF_DECLARATION',
    caseId: null,
    verifiedAtMs: null,
    decidedAtMs: Date.now() - 1_000,
    expiresAtMs: null,
  };

  const verifiedAdult = {
    uid: 'user-1',
    status: 'VERIFIED_ADULT',
    policyVersion: 1,
    source: 'AGE_REVERIFICATION',
    method: 'MANUAL_REVIEW',
    caseId: 'case-1',
    verifiedAtMs: Date.now() - 1_000,
    expiresAtMs: null,
  };

  it('permite autoria com maioridade autodeclarada registrada no backend', () => {
    const decision = assertMediaAuthoringEligibilityData(
      eligibleUser,
      selfDeclaredAdult,
      'user-1'
    );

    assert.equal(decision.ageEligibility.allowed, true);
    assert.equal(decision.ageEligibility.status, 'SELF_DECLARED_ADULT');
    assert.equal(decision.ageEligibilityVerifiedAdult, false);
  });

  it('preserva assurance forte quando a conta já é verificada', () => {
    const decision = assertMediaAuthoringEligibilityData(
      eligibleUser,
      verifiedAdult,
      'user-1'
    );

    assert.equal(decision.ageEligibility.allowed, true);
    assert.equal(decision.ageEligibilityVerifiedAdult, true);
  });

  it('bloqueia menoridade, reverificação e lifecycle restrito', () => {
    assert.throws(
      () => assertMediaAuthoringEligibilityData(
        eligibleUser,
        {
          ...verifiedAdult,
          status: 'DENIED_UNDERAGE',
          verifiedAtMs: null,
        },
        'user-1'
      ),
      HttpsError
    );

    assert.throws(
      () => assertMediaAuthoringEligibilityData(
        {
          ...eligibleUser,
          ageReverification: { status: 'REQUIRED' },
        },
        verifiedAdult,
        'user-1'
      ),
      HttpsError
    );

    assert.throws(
      () => assertMediaAuthoringEligibilityData(
        {
          ...eligibleUser,
          suspended: true,
        },
        verifiedAdult,
        'user-1'
      ),
      HttpsError
    );
  });
});
