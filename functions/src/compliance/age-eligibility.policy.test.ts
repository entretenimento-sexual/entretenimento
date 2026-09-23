import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AGE_ELIGIBILITY_POLICY_VERSION,
  evaluateCanonicalAgeEligibility,
} from './age-eligibility.policy';

const NOW = 1_800_000_000_000;

describe('age-eligibility.policy', () => {
  it('libera somente registro adulto válido e vigente', () => {
    const decision = evaluateCanonicalAgeEligibility({
      uid: 'user-1',
      nowMs: NOW,
      rawRecord: {
        uid: 'user-1',
        status: 'VERIFIED_ADULT',
        policyVersion: AGE_ELIGIBILITY_POLICY_VERSION,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        caseId: 'case-1',
        verifiedAtMs: NOW - 1_000,
        expiresAtMs: null,
      },
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.status, 'VERIFIED_ADULT');
    assert.equal(decision.denialReason, null);
  });

  it('libera autodeclaração adulta sem tratá-la como verificação forte', () => {
    const decision = evaluateCanonicalAgeEligibility({
      uid: 'user-1',
      nowMs: NOW,
      rawRecord: {
        uid: 'user-1',
        status: 'DECLARED_ADULT',
        policyVersion: AGE_ELIGIBILITY_POLICY_VERSION,
        source: 'SELF_ATTESTATION',
        method: 'SELF_ATTESTATION',
        assuranceLevel: 'SELF_ATTESTED',
        caseId: null,
        verifiedAtMs: null,
        decidedAtMs: NOW - 1_000,
        expiresAtMs: null,
      },
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.status, 'DECLARED_ADULT');
    assert.equal(decision.assuranceLevel, 'SELF_ATTESTED');
    assert.equal(decision.verifiedAtMs, null);
  });

  it('não aceita autodeclaração disfarçada de VERIFIED_ADULT', () => {
    const decision = evaluateCanonicalAgeEligibility({
      uid: 'user-1',
      nowMs: NOW,
      rawRecord: {
        uid: 'user-1',
        status: 'VERIFIED_ADULT',
        policyVersion: AGE_ELIGIBILITY_POLICY_VERSION,
        source: 'SELF_ATTESTATION',
        method: 'SELF_ATTESTATION',
        assuranceLevel: 'SELF_ATTESTED',
        caseId: null,
        verifiedAtMs: NOW - 1_000,
        decidedAtMs: NOW - 1_000,
        expiresAtMs: null,
      },
    });

    assert.equal(decision.allowed, false);
  });

  it('falha fechado quando o registro não existe', () => {
    const decision = evaluateCanonicalAgeEligibility({
      uid: 'user-1',
      nowMs: NOW,
      rawRecord: null,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'verification_required');
  });

  it('nega explicitamente conta classificada como menor', () => {
    const decision = evaluateCanonicalAgeEligibility({
      uid: 'user-1',
      nowMs: NOW,
      rawRecord: {
        uid: 'user-1',
        status: 'DENIED_UNDERAGE',
        policyVersion: AGE_ELIGIBILITY_POLICY_VERSION,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        caseId: 'case-1',
        verifiedAtMs: null,
        expiresAtMs: null,
      },
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.denialReason, 'underage');
  });

  it('não aceita registro vencido ou política divergente', () => {
    const expired = evaluateCanonicalAgeEligibility({
      uid: 'user-1',
      nowMs: NOW,
      rawRecord: {
        uid: 'user-1',
        status: 'VERIFIED_ADULT',
        policyVersion: AGE_ELIGIBILITY_POLICY_VERSION,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        caseId: 'case-1',
        verifiedAtMs: NOW - 10_000,
        expiresAtMs: NOW - 1,
      },
    });
    const outdated = evaluateCanonicalAgeEligibility({
      uid: 'user-1',
      nowMs: NOW,
      rawRecord: {
        uid: 'user-1',
        status: 'VERIFIED_ADULT',
        policyVersion: AGE_ELIGIBILITY_POLICY_VERSION + 1,
        source: 'AGE_REVERIFICATION',
        method: 'MANUAL_REVIEW',
        caseId: 'case-1',
        verifiedAtMs: NOW - 10_000,
        expiresAtMs: null,
      },
    });

    assert.equal(expired.denialReason, 'verification_expired');
    assert.equal(outdated.denialReason, 'policy_outdated');
  });
});
