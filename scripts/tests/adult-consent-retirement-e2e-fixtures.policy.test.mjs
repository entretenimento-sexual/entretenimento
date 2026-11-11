import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');
const modern = [
  "scripts/dev/seed-community-membership-lifecycle.mjs",
  "scripts/tests/community-creation.e2e.mjs",
  "scripts/tests/failed-feed-photo-race.e2e.mjs",
  "scripts/tests/media-e2e-compliance-fixture.mjs",
  "scripts/tests/media-transaction-revocation.e2e.mjs",
  "scripts/tests/photo-publication.e2e.mjs",
  "scripts/tests/photo-social.e2e.mjs",
  "scripts/tests/profile-age-reverification-media.e2e.mjs",
  "scripts/tests/profile-age-reverification.e2e.mjs",
  "scripts/tests/registration-lockdown-candidate.e2e.mjs",
  "scripts/tests/registration-nickname-callables.e2e.mjs",
  "scripts/tests/video-publication.e2e.mjs",
  "scripts/tests/video-ratings.e2e.mjs",
  "scripts/tests/video-social.e2e.mjs"
];

test('fixtures atuais nao materializam consentimento v1 em contas novas', () => {
  for (const path of modern) {
    const source = read(path);
    assert.doesNotMatch(source, /\binitialAdultConsentRequired\b|\badultConsent\b|\bADULT_CONSENT_VERSION\b/, path);
  }
});

test('backfill historico preserva a representacao v1 como caso legado', () => {
  const source = read('scripts/tests/discovery-legacy-backfill.e2e.mjs');
  assert.match(source, /initialAdultConsentRequired\s*:\s*true/);
  assert.match(source, /adultConsent\s*:\s*\{\s*accepted\s*:\s*true\s*,\s*version\s*:\s*'v1'/);
});

test('criacao de comunidade e reverificacao exigem Termos atuais com aviso', () => {
  for (const path of ['scripts/tests/community-creation.e2e.mjs', 'scripts/tests/profile-age-reverification.e2e.mjs']) {
    const source = read(path);
    assert.match(source, /acceptedTerms\s*:\s*\{[\s\S]*?version\s*:\s*'v3'/, path);
    assert.match(source, /acknowledgedPrivacyNotice\s*:\s*true/, path);
    assert.doesNotMatch(source, /acceptedTerms\s*:\s*\{\s*accepted\s*:\s*true\s*,\s*version\s*:\s*'v1'/, path);
  }
});

test('cadastro de nickname continua cobrindo Termos e elegibilidade canonica', () => {
  const source = read('scripts/tests/registration-nickname-callables.e2e.mjs');
  assert.match(source, /acceptedTerms\s*:\s*\{\s*accepted\s*:\s*true\s*,\s*version\s*:\s*'v2'/);
  assert.match(source, /acknowledgedPrivacyNotice\s*:\s*false/);
  assert.match(source, /age_eligibility_records/);
  assert.match(source, /status:\s*'VERIFIED_ADULT'/);
});

test('workflow valida redirecionamento legado em desktop e mobile, nao a tela extinta', () => {
  const source = read('.github/workflows/registration-visual-validation.yml');
  assert.match(source, /page\.goto\('\$BASE\/adulto\/confirmar'\)/);
  assert.equal((source.match(/waitForURL\(\(url\)/g) ?? []).length, 2);
  assert.match(source, /desktop-legacy-redirect\.metrics\.log/);
  assert.match(source, /mobile-legacy-redirect\.metrics\.log/);
  assert.doesNotMatch(source, /waitForSelector\('\.adult-consent__card'/);
  assert.doesNotMatch(source, /Adult confirmation desktop incomplete|Adult confirmation mobile actions\/layout regression/);
});

test('criacao canonica e Rules permanecem livres do marcador legado', () => {
  const backend = read('functions/src/auth/user-registration-seed.ts');
  const angular = read('src/app/core/services/autentication/register/registration-bootstrap.service.ts');
  const rules = read('firestore-rules/users.rules');
  for (const seed of [backend, angular]) {
    assert.doesNotMatch(seed, /initialAdultConsentRequired\s*:|adultConsent\s*:/);
  }
  assert.match(rules, /initialAdultConsentRequired/);
  assert.match(rules, /adultConsent/);
});
