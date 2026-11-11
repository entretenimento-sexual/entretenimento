// Contrato estático da aposentadoria do consentimento adulto v1 em Comunidades.
// Não lê ou modifica dados: reforça a separação entre histórico e autorização.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(path, 'utf8');

test('guard central exige lifecycle e termos, não consentimento histórico', () => {
  const source = read('functions/src/account_lifecycle/interaction-access.policy.ts');
  assert.match(source, /accountStatus\s*!==\s*'active'/);
  assert.match(source, /interactionBlocked\s*===\s*true/);
  assert.match(source, /moderationAutomationHold/);
  assert.match(source, /hasCurrentTerms\(user\.acceptedTerms\)/);
  assert.doesNotMatch(source, /user\.(?:adultConsent|initialAdultConsentRequired)/);
});

test('social e membership compartilham autoridade sem recriar gate legado', () => {
  const social = read('functions/src/community/community-social-access.service.ts');
  const membership = read('functions/src/community/community-membership-eligibility.service.ts');
  assert.match(social, /assertPlatformAccountAccessData\(user\)/);
  assert.match(social, /user\['uid'\]\s*!==\s*uid/);
  assert.match(membership, /assertCommunitySocialAccessEligible\(rawUser, uid\)/);
  assert.match(membership, /profileCompleted'\]\s*!==\s*true/);
  assert.doesNotMatch(social + membership, /(?:user|rawUser)\.(?:adultConsent|initialAdultConsentRequired)/);
});

test('testes positivos não usam consentimento v1 como requisito padrão', () => {
  const socialTest = read('functions/src/community/community-social-access.service.test.ts');
  const membershipTest = read('functions/src/community/community-membership-eligibility.service.test.ts');
  for (const source of [socialTest, membershipTest]) {
    const fixture = source.split('function eligibleUser')[1]?.split('function ')[0]?.split("test('")[0] ?? '';
    assert.ok(fixture.includes('acceptedTerms'), 'fixture exige Termos');
    assert.doesNotMatch(fixture, /adultConsent\s*:/);
    assert.match(source, /assert\.doesNotThrow/);
    assert.match(source, /assert\.throws/);
    assert.doesNotMatch(source, /adult_consent_required/);
  }
});

test('erro legado de Media aponta ao status, sem tela removida', () => {
  const source = read('src/app/core/services/media/media-error.catalog.ts');
  for (const code of ['ADULT_CONSENT_REQUIRED', 'adult_consent_required']) {
    const start = source.indexOf('    ' + code + ': {');
    assert.notEqual(start, -1, 'compatibilidade preservada: ' + code);
    const excerpt = source.slice(start, start + 260);
    assert.match(excerpt, /route:\s*'\/conta\/status'/);
  }
  assert.doesNotMatch(source, /route:\s*'\/adulto\/confirmar'/);
});
