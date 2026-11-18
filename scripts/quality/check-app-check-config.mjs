import { readFileSync } from 'node:fs';

const TARGETS = Object.freeze({
  staging: {
    environmentPath: 'src/environments/environment.staging.ts',
    expectedProvider: 'reCaptchaEnterprise',
  },
  prod: {
    environmentPath: 'src/environments/environment.prod.ts',
    expectedProvider: 'reCaptchaV3',
  },
});

const target = String(process.argv[2] ?? '').trim();
const config = Object.hasOwn(TARGETS, target) ? TARGETS[target] : undefined;

if (!config) {
  console.error('Uso: node scripts/quality/check-app-check-config.mjs <staging|prod>');
  process.exit(1);
}

const { environmentPath, expectedProvider } = config;
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

if (provider !== expectedProvider) {
  console.error(`App Check de ${target} precisa usar o provedor ${expectedProvider}.`);
  process.exit(1);
}

if (placeholder) {
  console.error(
    `App Check de ${target} ainda usa siteKey ausente ou placeholder. Configure uma chave real antes da validação.`
  );
  process.exit(1);
}

console.log(`App Check de ${target}: configuração mínima válida.`);
