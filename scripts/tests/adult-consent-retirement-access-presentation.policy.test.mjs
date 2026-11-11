import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (file) => readFileSync(file, 'utf8');

const messageFiles = [
  'src/app/shared/components/content-access-notice/content-access-notice.component.ts',
  'src/app/community/presentation/community-error.messages.ts',
  'src/app/community/presentation/community-social-access-error.messages.ts',
  'src/app/community/presentation/community-highlight-error.messages.ts',
];

test('mensagens de acesso adulto não oferecem aceite de consentimento v1', () => {
  for (const file of messageFiles) {
    const content = read(file);
    assert.doesNotMatch(content, /Confirme (?:seu |o )?acesso adulto/iu, file);
    assert.match(content, /adult_access_required/u, file);
  }
});

test('códigos legados encaminham ao status, nunca à confirmação extinta', () => {
  const nav = read('src/app/core/access/content-access-navigation.service.ts');
  const catalog = read('src/app/core/services/error-handler/application-error-presentation.catalog.ts');
  assert.match(nav, /confirm_adult_access:\s*\['\/conta\/status'\]/u);
  const match = catalog.match(/confirm_adult_access:\s*\{[\s\S]*?dismissLabel:/u);
  assert.ok(match, 'apresentação da ação histórica deve existir');
  assert.match(match[0], /route: '\/conta\/status'/u);
  assert.doesNotMatch(match[0], /\/register\/welcome|\/adulto\/confirmar/u);
});

test('camada visual conserva semântica de elegibilidade, não de aceite', () => {
  const model = read('src/app/core/access/content-access-policy.model.ts');
  const policy = read('src/app/core/access/content-access-policy.service.ts');
  const notice = read(messageFiles[0]);
  assert.match(model, /Consentimento v1 é histórico/u);
  assert.doesNotMatch(policy, /initialAdultConsentRequired|\.adultConsent/u);
  assert.match(notice, /actionLabel: 'Ver conta'/u);
  assert.match(notice, /Consulte o status da conta/u);
});

test('gatilho de promoção ignora consentimento v1 sem retirar bloqueios operacionais', () => {
  const source = read('functions/src/promotion-boost/photo-promotion-target.policy.ts');
  assert.doesNotMatch(source, /adultConsent/u);
  for (const field of ['accountStatus', 'suspended', 'interactionBlocked', 'moderationAutomationHold', 'acceptedTerms']) {
    assert.match(source, new RegExp(field, 'u'));
  }
});

test('conexões exclusivas preservam bloqueios etários sem exigir consentimento antigo', () => {
  const policy = read('functions/src/subscriber-experiences/exclusive-connections/exclusive-connections-access.policy.ts');
  assert.match(policy, /AGE_REVERIFICATION_RESTRICTED_STATES/u);
  assert.match(policy, /adult_access_required/u);
  assert.doesNotMatch(policy, /adultConsent|initialAdultConsentRequired/u);
});
