import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateExclusiveConnectionsEligibility,
} from './exclusive-connections-access.policy';

function createUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'user-1',
    profileCompleted: true,
    accountStatus: 'active',
    interactionBlocked: false,
    accountLocked: false,
    loginAllowed: true,
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

test('nega ausência de consentimento ou reverificação restrita', () => {
  assert.equal(
    evaluateExclusiveConnectionsEligibility(
      createUser({ adultConsent: { accepted: false } }),
      'user-1'
    ).reason,
    'adult_access_required'
  );
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

test('mantém compatibilidade com conta legada sem aceite obrigatório explícito', () => {
  const user = createUser({
    initialAdultConsentRequired: undefined,
    adultConsent: undefined,
  });

  assert.deepEqual(
    evaluateExclusiveConnectionsEligibility(user, 'user-1'),
    { allowed: true, reason: null }
  );
});
