// scripts/dev/wait-for-functions-callables.mjs
// -----------------------------------------------------------------------------
// Aguarda callables críticas do Functions Emulator ficarem realmente roteáveis.
// Não executa lógica de negócio: usa apenas o preflight OPTIONS.
// -----------------------------------------------------------------------------

import { probeFunctionsCallable } from './functions-emulator-health.mjs';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.split('=');
    return [key, value.join('=')];
  })
);

const names = String(
  options['--names'] || 'acceptAdultSelfDeclaration'
)
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const host = options['--host'] || '127.0.0.1';
const port = Number(options['--port'] || 5001);
const projectId =
  options['--project'] ||
  process.env.FIREBASE_PROJECT_ID ||
  'entretenimento-sexual';
const region = options['--region'] || 'us-central1';
const origin = options['--origin'] || 'http://localhost:4200';
const timeoutMs = Number(options['--timeout'] || 180_000);
const intervalMs = Math.max(250, Number(options['--interval'] || 750));

if (names.length === 0) {
  console.error('[functions:ready] Informe ao menos uma callable em --names.');
  process.exit(2);
}

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('[functions:ready] --timeout precisa ser positivo.');
  process.exit(2);
}

if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
  console.error('[functions:ready] --interval precisa ser positivo.');
  process.exit(2);
}

const sleep = (durationMs) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

console.log(
  `[functions:ready] Aguardando ${names.join(', ')} em ` +
    `${host}:${port}/${projectId}/${region}.`
);

const startedAt = Date.now();
let lastResults = [];

while (Date.now() - startedAt <= timeoutMs) {
  lastResults = await Promise.all(
    names.map((name) =>
      probeFunctionsCallable({
        name,
        host,
        port,
        projectId,
        region,
        origin,
        timeoutMs: Math.min(2_500, intervalMs * 2),
      })
    )
  );

  if (lastResults.every((result) => result.ready)) {
    console.log(
      `[functions:ready] Callables prontas: ${names.join(', ')}.`
    );
    process.exit(0);
  }

  await sleep(intervalMs);
}

console.error(
  '[functions:ready] Timeout: o Functions Emulator abriu a porta, ' +
    'mas a superfície callable crítica não ficou pronta.'
);

for (const result of lastResults) {
  if (result.ready) continue;

  console.error(
    `  - ${result.name}: status=${result.status} ` +
      `allow-origin=${result.allowOrigin || 'ausente'} ` +
      `url=${result.url}` +
      (result.error ? ` erro=${result.error}` : '')
  );
}

console.error(
  '[functions:ready] Recompile Functions e reinicie o Emulator; ' +
    'não tente corrigir isso adicionando CORS manual ao handler onCall.'
);
process.exit(1);
