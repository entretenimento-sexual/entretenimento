import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const load = (relative) => readFileSync(join(process.cwd(), relative), 'utf8');
const guard = load('functions/src/account_lifecycle/interaction-access.policy.ts');
const media = load('functions/src/media/application/media-authoring-eligibility.service.ts');
const guardTest = load('functions/src/account_lifecycle/interaction-access.policy.test.ts');
const mediaTest = load('functions/src/media/application/media-authoring-eligibility.service.test.ts');

test('guard de produto preserva lifecycle e termos vigentes', () => {
  assert.match(guard, /accountStatus\s*!==\s*'active'/);
  assert.match(guard, /user\.accountLocked\s*===\s*true/);
  assert.match(guard, /user\.interactionBlocked\s*===\s*true/);
  assert.match(guard, /hasCurrentTerms\(user\.acceptedTerms\)/);
  assert.match(guard, /moderationAutomationHold/);
});

test('guard central nao volta a exigir adultConsent v1', () => {
  assert.doesNotMatch(guard, /hasCurrentAdultConsent|ADULT_CONSENT_VERSION|adult_consent_required|accept_adult_consent|user\.adultConsent/);
  assert.match(guardTest, /não usa marcador histórico como gate de produto/);
});

test('media reutiliza guard central sem exigir consentimento antigo', () => {
  assert.match(media, /assertPlatformAccountAccessData\(user\)/);
  assert.match(media, /await assertInteractionAccess\(normalizedUid\)/);
  assert.doesNotMatch(media, /adultConsent|initialAdultConsentRequired/);
});

test('testes de media cobrem ausencia e recusa historica, mas mantem bloqueios', () => {
  assert.match(mediaTest, /permite autoria sem consentimento v1, inclusive histórico recusado/);
  assert.match(mediaTest, /accepted:\s*false,\s*version:\s*'v1'/);
  assert.match(mediaTest, /accountLocked:\s*true/);
  assert.match(mediaTest, /loginAllowed:\s*false/);
  assert.match(mediaTest, /moderationAutomationHold/);
  assert.match(mediaTest, /bloqueia termos atuais ausentes ou inválidos/);
});
