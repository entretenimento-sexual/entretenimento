import { readFileSync } from 'node:fs';

const TARGETS = Object.freeze({
  staging: 'src/environments/environment.staging.ts',
  prod: 'src/environments/environment.prod.ts',
});

const target = String(process.argv[2] ?? '').trim();
const environmentPath = TARGETS[target];

if (!environmentPath) {
  console.error('Uso: node scripts/quality/check-app-check-config.mjs <staging|prod>');
  process.exit(1);
}

const source = readFileSync(environmentPath, 'utf8');
const appCheckBlock = source.match(/appCheck\s*:\s*\{([\s\S]*?)\n\s*\},/m)?.[1] ?? '';
const siteKey = appCheckBlock.match(/siteKey\s*:\s*['"`]([^'"`]+)['"`]/)?.[1]?.trim() ?? '';
const enabled = /enabled\s*:\s*true\b/.test(appCheckBlock);
const provider = appCheckBlock.match(/provider\s*:\s*['"`]([^'"`]+)['"`]/)?.[1]?.trim() ?? '';
const placeholder =
  !siteKey
  || /(?:^|[-_])(dev|staging|prod)-recaptcha-v3-site-key$/i.test(siteKey)
  || /placeholder/i.test(siteKey);

if (!enabled) {
  console.error(`App Check de ${target} precisa estar habilitado em ${environmentPath}.`);
  process.exit(1);
}

if (provider !== 'reCaptchaV3') {
  console.error(`App Check de ${target} precisa usar o provedor reCaptchaV3.`);
  process.exit(1);
}

if (placeholder) {
  console.error(
    `App Check de ${target} ainda usa siteKey ausente ou placeholder. Configure uma chave real antes da validação.`
  );
  process.exit(1);
}

console.log(`App Check de ${target}: configuração mínima válida.`);
