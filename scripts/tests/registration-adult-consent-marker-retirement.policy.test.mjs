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
const create = body(rules, 'createRequiredDefaultsOk');
const protectedChanges = body(rules, 'selfChangingSensitiveKeys');

test('cadastro novo exige os defaults privados e os termos iniciais, sem campo legado', () => {
  assert.ok(create);
  const required = create.match(/data\.keys\(\)\.hasAll\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
  for (const field of ['uid', 'registrationFlowVersion', 'registrationCompletedAt', 'profileCompleted', 'acceptedTerms']) {
    assert.ok(required.includes(`"${field}"`), `ausente campo obrigatório ${field}`);
  }
  assert.ok(!required.includes('initialAdultConsentRequired'));
  assert.match(create, /initialTermsDefaultsOk\(data\)/);
  assert.match(create, /data\.profileCompleted == false/);
});

test('Rules proíbem o marcador e adultConsent na criação client-side', () => {
  const forbidden = create.match(/!data\.keys\(\)\.hasAny\(\[([\s\S]*?)\]\)/)?.[1] ?? '';
  assert.ok(forbidden.includes('"initialAdultConsentRequired"'));
  assert.ok(forbidden.includes('"adultConsent"'));
  assert.ok(!create.includes('data.initialAdultConsentRequired'));
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

test('conclusão de registro exige idade canônica e termos, não consentimento v1', () => {
  const completion = body(rules, 'selfCompletingRegistration');
  assert.match(completion, /acceptedTermsReady\(data\)/);
  assert.match(completion, /currentUserHasRegistrationAgeEligibility\(\)/);
  assert.doesNotMatch(completion, /adultConsentReady|initialAdultConsentRequired/);
});
