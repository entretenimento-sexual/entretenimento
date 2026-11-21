import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRIVACY_NOTICE_VERSION,
  TERMS_ACCEPTANCE_VERSION,
  TERMS_DOCUMENT_VERSION,
} from '../../compliance/platform-legal.constants';

import {
  assertExclusiveConnectionsEligibility,
  evaluateExclusiveConnectionsEligibility,
} from './exclusive-connections-access.policy';

const currentTerms = {
  accepted: true,
  version: TERMS_ACCEPTANCE_VERSION,
  termsDocumentVersion: TERMS_DOCUMENT_VERSION,
  privacyNoticeVersion: PRIVACY_NOTICE_VERSION,
  acknowledgedPrivacyNotice: true,
};

function createUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    profileCompleted: true,
    accountStatus: 'active',
    interactionBlocked: false,
    accountLocked: false,
    loginAllowed: true,
    acceptedTerms: currentTerms,
    adultConsent: { accepted: true },
    initialAdultConsentRequired: true,
    ageReverification: { status: 'VERIFIED', result: 'ADULT' },
    gender: 'homem',
    orientation: 'gay',
    estado: 'RJ',
    municipio: 'Niterói',
    ...overrides,
  };
}

test('permite perfil completo, adulto e operacional', () => {
  assert.deepEqual(
    evaluateExclusiveConnectionsEligibility(createUser(), 'user-1'),
    { allowed: true, reason: null }
  );
});

test('nega documento ausente ou vinculado a outro UID', () => {
  assert.equal(
    evaluateExclusiveConnectionsEligibility(null, 'user-1').reason,
    'profile_missing'
  );
  assert.equal(
    evaluateExclusiveConnectionsEligibility(
      createUser({ uid: 'user-2' }),
      'user-1'
    ).reason,
    'profile_missing'
  );
});

test('nega conta suspensa, bloqueada ou inativa', () => {
  assert.equal(
    evaluateExclusiveConnectionsEligibility(
      createUser({ accountStatus: 'moderation_suspended' }),
      'user-1'
    ).reason,
    'account_restricted'
  );
  assert.equal(
    evaluateExclusiveConnectionsEligibility(
      createUser({ interactionBlocked: true }),
      'user-1'
    ).reason,
    'account_restricted'
  );
});

test('reverificação restrita permanece impeditiva', () => {
  assert.deepEqual(evaluateExclusiveConnectionsEligibility(
    createUser({ adultConsent: { accepted: false } }), 'user-1'
  ), { allowed: true, reason: null });
  assert.equal(
    evaluateExclusiveConnectionsEligibility(
      createUser({ ageReverification: { status: 'UNDER_REVIEW' } }),
      'user-1'
    ).reason,
    'adult_access_required'
  );
});

test('nega perfil incompleto ou sem campos mínimos', () => {
  assert.equal(
    evaluateExclusiveConnectionsEligibility(
      createUser({ profileCompleted: false }),
      'user-1'
    ).reason,
    'profile_incomplete'
  );
  assert.equal(
    evaluateExclusiveConnectionsEligibility(
      createUser({ municipio: '   ' }),
      'user-1'
    ).reason,
    'profile_field_missing'
  );
});

test('consentimento v1 recusado em conta histórica não substitui elegibilidade etária', () => {
  assert.deepEqual(
    evaluateExclusiveConnectionsEligibility(
      createUser({ initialAdultConsentRequired: true, adultConsent: { accepted: false } }),
      'user-1'
    ),
    { allowed: true, reason: null }
  );
});

test('permite conta com Termos vigentes sem consentimento adulto histórico', () => {
  const user = createUser({
    initialAdultConsentRequired: undefined,
    adultConsent: undefined,
  });

  assert.deepEqual(
    evaluateExclusiveConnectionsEligibility(user, 'user-1'),
    { allowed: true, reason: null }
  );
});

test('exige os documentos vigentes para Conexões Exclusivas', () => {
  for (const acceptedTerms of [
    undefined,
    { ...currentTerms, termsDocumentVersion: 'anterior' },
    { ...currentTerms, privacyNoticeVersion: 'anterior' },
  ]) {
    const user = createUser({ acceptedTerms });
    assert.deepEqual(
      evaluateExclusiveConnectionsEligibility(user, 'user-1'),
      { allowed: false, reason: 'terms_required' }
    );
    assert.throws(() => assertExclusiveConnectionsEligibility(user, 'user-1'), {
      code: 'failed-precondition',
      details: { reason: 'terms_required', recommendedAction: 'accept_terms' },
    });
  }
});
