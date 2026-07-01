// scripts/admin/run-discovery-backfill.mjs
// -----------------------------------------------------------------------------
// ADMIN RUNNER - DISCOVERY BACKFILL
// -----------------------------------------------------------------------------
// Executa a callable backfillPublicProfileDiscovery de forma controlada.
//
// Segurança operacional:
// - não guarda credenciais no repositório;
// - exige FIREBASE_ID_TOKEN de um usuário administrativo autenticado;
// - dryRun=true por padrão;
// - escrita real exige BACKFILL_DRY_RUN=false e BACKFILL_CONFIRM_WRITE=YES;
// - processa em lotes pequenos com cursor;
// - imprime nextCursor para continuação manual ou por páginas controladas.
//
// Uso recomendado, depois do deploy da Function:
//
//   $env:FIREBASE_ID_TOKEN="<id-token-admin>"
//   npm run admin:discovery-backfill -- --limit=100 --maxPages=1
//
// Continuação a partir do cursor retornado:
//
//   npm run admin:discovery-backfill -- --limit=100 --cursor="<nextCursor>"
//
// Escrita real, somente após dryRun conferido:
//
//   $env:BACKFILL_CONFIRM_WRITE="YES"
//   npm run admin:discovery-backfill -- --dryRun=false --limit=100 --cursor="<cursor>"
// -----------------------------------------------------------------------------

const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const DEFAULT_REGION = 'us-central1';
const FUNCTION_NAME = 'backfillPublicProfileDiscovery';

const args = parseArgs(process.argv.slice(2));

const projectId = readStringOption('project', 'FIREBASE_PROJECT_ID', DEFAULT_PROJECT_ID);
const region = readStringOption('region', 'FUNCTIONS_REGION', DEFAULT_REGION);
const functionUrl = readStringOption(
  'url',
  'BACKFILL_FUNCTION_URL',
  `https://${region}-${projectId}.cloudfunctions.net/${FUNCTION_NAME}`
);

const idToken = readStringEnv('FIREBASE_ID_TOKEN');
const limit = readNumberOption('limit', 'BACKFILL_LIMIT', 100, 1, 500);
const maxPages = readNumberOption('maxPages', 'BACKFILL_MAX_PAGES', 1, 1, 50);
const dryRun = readBooleanOption('dryRun', 'BACKFILL_DRY_RUN', true);
let cursor = readStringOption('cursor', 'BACKFILL_CURSOR', null);

if (!idToken) {
  abort(
    'FIREBASE_ID_TOKEN ausente. Gere/forneça um ID token de usuário administrativo antes de chamar o backfill.'
  );
}

if (!dryRun && process.env.BACKFILL_CONFIRM_WRITE !== 'YES') {
  abort(
    'Escrita real bloqueada. Para dryRun=false, defina BACKFILL_CONFIRM_WRITE=YES explicitamente.'
  );
}

console.log('[discovery-backfill] Iniciando runner administrativo.', {
  projectId,
  region,
  functionUrl,
  dryRun,
  limit,
  maxPages,
  cursor,
});

let lastResult = null;

for (let page = 1; page <= maxPages; page += 1) {
  const payload = {
    limit,
    dryRun,
    startAfterUid: cursor,
  };

  console.log(`[discovery-backfill] Página ${page}/${maxPages}`, payload);

  const result = await callCallable(functionUrl, idToken, payload);
  lastResult = result;

  console.log('[discovery-backfill] Resultado:', result);

  cursor = normalizeOptionalString(result?.nextCursor);

  if (!result?.hasMore || !cursor) {
    console.log('[discovery-backfill] Encerrado: sem próxima página.');
    break;
  }
}

if (lastResult?.hasMore && cursor) {
  console.log('[discovery-backfill] Próxima continuação disponível:', {
    BACKFILL_CURSOR: cursor,
    npm: `npm run admin:discovery-backfill -- --limit=${limit} --cursor="${cursor}"`,
  });
}

console.log('[discovery-backfill] Runner finalizado.');

async function callCallable(url, token, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data }),
  });

  const text = await response.text();
  const json = parseJson(text);

  if (!response.ok || json?.error) {
    const message = json?.error?.message || text || `HTTP ${response.status}`;
    throw new Error(`[discovery-backfill] Falha na callable: ${message}`);
  }

  return json?.result ?? json;
}

function parseArgs(values) {
  const parsed = new Map();

  for (const value of values) {
    if (!value.startsWith('--')) {
      continue;
    }

    const [rawKey, ...rawValue] = value.slice(2).split('=');
    const key = rawKey.trim();
    const optionValue = rawValue.length ? rawValue.join('=').trim() : 'true';

    if (key) {
      parsed.set(key, optionValue);
    }
  }

  return parsed;
}

function readStringEnv(name) {
  return normalizeOptionalString(process.env[name]);
}

function readStringOption(argName, envName, fallback) {
  return normalizeOptionalString(args.get(argName)) ?? readStringEnv(envName) ?? fallback;
}

function readNumberOption(argName, envName, fallback, min, max) {
  const rawValue = args.get(argName) ?? process.env[envName];
  const parsed = Number(rawValue ?? fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function readBooleanOption(argName, envName, fallback) {
  const rawValue = normalizeOptionalString(args.get(argName) ?? process.env[envName]);

  if (!rawValue) {
    return fallback;
  }

  if (['1', 'true', 'yes', 'sim'].includes(rawValue.toLowerCase())) {
    return true;
  }

  if (['0', 'false', 'no', 'nao', 'não'].includes(rawValue.toLowerCase())) {
    return false;
  }

  return fallback;
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();

  return text.length ? text : null;
}

function parseJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return null;
  }
}

function abort(message) {
  console.error(`[discovery-backfill] ${message}`);
  process.exit(1);
}
