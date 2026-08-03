import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluatePrivateMediaDraftEligibility } from './private-media-draft-eligibility.policy';

function eligibleUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    accountStatus: 'active',
    emailVerified: true,
    profileCompleted: true,
    adultConsent: { accepted: true },
    acceptedTerms: {
      accepted: true,
      adultAccessAcknowledgement: true,
    },
    ...overrides,
  };
}

test('permite conta operacional, adulta, verificada e completa', () => {
  assert.deepEqual(
    evaluatePrivateMediaDraftEligibility(eligibleUser(), 'user-1', true),
    {
      allowed: true,
      reason: null,
      errorCode: null,
      message: null,
      recovery: null,
    }
  );
});

test('aceita claim verificada mesmo quando a projeção ainda não sincronizou', () => {
  const decision = evaluatePrivateMediaDraftEligibility(
    eligibleUser({ emailVerified: false }),
    'user-1',
    true
  );

  assert.equal(decision.allowed, true);
});

test('bloqueia conta restrita com código operacional estável', () => {
  const decision = evaluatePrivateMediaDraftEligibility(
    eligibleUser({ suspended: true }),
    'user-1',
    true
  );

  assert.equal(decision.allowed, false);
  assert.equal(decision.errorCode, 'MEDIA_UPLOAD_NOT_ALLOWED');
});

test('diferencia e-mail, maioridade, termos e perfil incompleto', () => {
  assert.equal(
    evaluatePrivateMediaDraftEligibility(
      eligibleUser({ emailVerified: false }),
      'user-1',
      false
    ).errorCode,
    'MEDIA_EMAIL_VERIFICATION_REQUIRED'
  );
  assert.equal(
    evaluatePrivateMediaDraftEligibility(
      eligibleUser({ idade: 17 }),
      'user-1',
      true
    ).errorCode,
    'MEDIA_ADULT_ACCESS_REQUIRED'
  );
  assert.equal(
    evaluatePrivateMediaDraftEligibility(
      eligibleUser({ acceptedTerms: { accepted: false } }),
      'user-1',
      true
    ).errorCode,
    'MEDIA_TERMS_REQUIRED'
  );
  assert.equal(
    evaluatePrivateMediaDraftEligibility(
      eligibleUser({ profileCompleted: false }),
      'user-1',
      true
    ).errorCode,
    'MEDIA_PROFILE_INCOMPLETE'
  );
});
