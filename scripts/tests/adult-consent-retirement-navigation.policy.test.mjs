import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('ação histórica de acesso adulto não encaminha à página removida', () => {
  const source = read('src/app/core/access/content-access-navigation.service.ts');
  assert.match(source, /confirm_adult_access:\s*\['\/conta\/status'\]/u);
  assert.doesNotMatch(source, /confirm_adult_access:\s*\['\/adulto\/confirmar'\]/u);
});

test('catálogo de comunidade oferece status da conta em vez de aceite extinto', () => {
  const source = read('src/app/community/presentation/community-error.catalog.ts');
  const line = source.split(/\r?\n/u).find((l) => l.includes('adult_access_required:'));
  assert.ok(line, 'adult_access_required deve permanecer para clientes legados');
  assert.match(line, /route:\s*'\/conta\/status'/u);
  assert.doesNotMatch(line, /\/adulto\/confirmar/u);
});

test('notificação de revisão de idade não direciona à tela de aceite removida', () => {
  const source = read('functions/src/moderation/moderation-safety-notification.service.ts');
  assert.doesNotMatch(source, /route:\s*verified\s*\?\s*'\/adulto\/confirmar'/u);
  assert.doesNotMatch(source, /\/adulto\/confirmar/u);
  const marker = source.indexOf("'initial-age-outcome'");
  assert.ok(marker >= 0, 'marcador da notificação inicial deve existir');
  const closing = source.indexOf('\n  });', marker);
  assert.ok(closing > marker, 'bloco de notificação inicial deve ser íntegro');
  const block = source.slice(marker, closing);
  assert.match(block, /route:\s*'\/conta\/status'/u);
});

test('alias de compatibilidade existe, mas não importa a página de consentimento removida', () => {
  const source = read('src/app/app-routing.module.ts');
  assert.match(source, /path:\s*'adulto\/confirmar'/u);
  assert.doesNotMatch(source, /adult-consent-page/u);
});

test('autorização do produto não reintroduz bloqueio por consentimento v1', () => {
  const files = [
    'src/app/core/access/content-access-policy.service.ts',
    'src/app/core/services/autentication/auth/access-control.service.ts',
    'functions/src/account_lifecycle/interaction-access.policy.ts',
    'functions/src/subscriber-experiences/exclusive-connections/exclusive-connections-access.policy.ts',
  ];
  for (const file of files) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
    assert.doesNotMatch(source, /(?:\.adultConsent|\['adultConsent'\]|\["adultConsent"\])/u, `${file}: consulta adultConsent`);
    assert.doesNotMatch(source, /initialAdultConsentRequired/u, `${file}: usa marcador legado`);
  }
});
