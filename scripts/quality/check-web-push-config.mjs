import { existsSync, readFileSync } from 'node:fs';

const TARGETS = Object.freeze({
  staging: 'src/environments/environment.staging.ts',
  prod: 'src/environments/environment.prod.ts',
});

const target = String(process.argv[2] ?? '').trim();
const environmentPath = TARGETS[target];

if (!environmentPath) {
  console.error(
    'Uso: node scripts/quality/check-web-push-config.mjs <staging|prod>'
  );
  process.exit(1);
}

const source = readFileSync(environmentPath, 'utf8');
const webPushBlock =
  source.match(/webPush\s*:\s*\{([\s\S]*?)\n\s*\},/m)?.[1] ?? '';
const vapidKey =
  webPushBlock.match(/vapidKey\s*:\s*['"`]([^'"`]+)['"`]/)?.[1]?.trim() ?? '';
const serviceWorkerPath =
  webPushBlock
    .match(/serviceWorkerPath\s*:\s*['"`]([^'"`]+)['"`]/)?.[1]
    ?.trim() ?? '';

const vapidKeyLooksValid =
  vapidKey.length >= 40 &&
  vapidKey.length <= 256 &&
  /^[A-Za-z0-9_-]+$/.test(vapidKey) &&
  !/(?:placeholder|your[-_]?public[-_]?vapid|vapid[-_]?key)/i.test(vapidKey);

if (!webPushBlock) {
  console.error(`Configuração webPush ausente em ${environmentPath}.`);
  process.exit(1);
}

if (!vapidKeyLooksValid) {
  console.error(
    `Web Push de ${target} ainda usa vapidKey ausente, placeholder ou inválida. ` +
      'Configure a chave pública VAPID do mesmo projeto Firebase antes da validação.'
  );
  process.exit(1);
}

if (!serviceWorkerPath.startsWith('/') || serviceWorkerPath.startsWith('//')) {
  console.error(
    `Web Push de ${target} precisa usar serviceWorkerPath absoluto e same-origin.`
  );
  process.exit(1);
}

const workerSourcePath = serviceWorkerPath.startsWith('/assets/')
  ? `src${serviceWorkerPath}`
  : null;

if (workerSourcePath && !existsSync(workerSourcePath)) {
  console.error(
    `Service worker configurado para Web Push não existe no repositório: ${workerSourcePath}.`
  );
  process.exit(1);
}

console.log(
  `Web Push de ${target}: VAPID pública e service worker com configuração mínima válida.`
);