import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');
const body = (source, fn) => source.match(
  new RegExp(`function ${fn}\\([^)]*\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`)
)?.[1] ?? '';

const rules = read('firestore-rules/users.rules');
const protectedChanges = body(rules, 'selfChangingSensitiveKeys');

test('cadastro novo é criado pelo backend com defaults privados', () => {
  const seed = read('functions/src/auth/user-registration-seed.ts');
  for (const field of [
    "registrationFlowVersion: REGISTRATION_FLOW_VERSION",
    "registrationCompletedAt: null",
    "profileCompleted: false",
    "publicVisibility: 'hidden'",
    "interactionBlocked: true",
  ]) {
    assert.ok(seed.includes(field), field);
  }
});

test('Rules impedem qualquer criação direta do documento privado', () => {
  assert.match(rules, /allow create: if false;/);
});

test('contas históricas mantêm campos legados protegidos contra mutações', () => {
  assert.ok(protectedChanges.includes('"initialAdultConsentRequired"'));
  assert.ok(protectedChanges.includes('"adultConsent"'));
  assert.match(read('src/app/core/interfaces/iuser-dados.ts'), /initialAdultConsentRequired\?: boolean/);
  assert.match(read('functions/src/account_lifecycle/_shared.ts'), /initialAdultConsentRequired\?: boolean \| null/);
});

test('backend e bootstrap Angular não criam novos marcadores legados', () => {
  for (const file of [
    'functions/src/auth/user-registration-seed.ts',
    'src/app/core/services/autentication/register/registration-bootstrap.service.ts',
  ]) {
    assert.doesNotMatch(read(file), /\binitialAdultConsentRequired\b/);
    assert.doesNotMatch(read(file), /\badultConsent\s*:/);
  }
});

test('a conclusão pelo backend exige idade canônica e os termos vigentes', () => {
  const completion = read('functions/src/registration/registration-profile-authority.handler.ts')
    .split('export const completeRegistrationProfile')[1]?.split('export const updateProfileOrientation')[0] ?? '';
  assert.match(completion, /evaluateCanonicalAgeEligibility\(/);
  assert.match(completion, /isRegistrationAgeAdmitted\(age, requiresTrustedAdultVerification\)/);
  assert.ok(completion.includes("terms?.['version'] !== TERMS_ACCEPTANCE_VERSION"));
  assert.ok(completion.includes("terms?.['acknowledgedPrivacyNotice'] !== true"));
  assert.doesNotMatch(completion, /adultConsentReady|initialAdultConsentRequired/);
});
