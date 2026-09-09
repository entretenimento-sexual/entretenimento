// scripts/admin/run-push-token-ownership-backfill.mjs
// -----------------------------------------------------------------------------
// ADMIN RUNNER - PUSH TOKEN OWNERSHIP BACKFILL
// -----------------------------------------------------------------------------
// Reconciliador manual para users/*/push_devices/* ativos.
//
// Segurança operacional:
// - não guarda credenciais no repositório;
// - exige FIREBASE_ID_TOKEN de admin/superadmin ou permissão específica;
// - dryRun=true por padrão;
// - escrita real exige PUSH_TOKEN_BACKFILL_CONFIRM_WRITE=YES;
// - pagina em lotes pequenos e retorna cursor para continuação;
// - não executa cron nem varredura permanente.
//
// Dry-run:
//   $env:FIREBASE_ID_TOKEN="<id-token-admin>"
//   node scripts/admin/run-push-token-ownership-backfill.mjs --limit=50
//
// Escrita real:
//   $env:PUSH_TOKEN_BACKFILL_CONFIRM_WRITE="YES"
//   node scripts/admin/run-push-token-ownership-backfill.mjs --dryRun=false --limit=50
// -----------------------------------------------------------------------------

const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const DEFAULT_REGION = 'us-central1';
const FUNCTION_NAME = 'backfillPushTokenOwnership';

const args = parseArgs(process.argv.slice(2));
const projectId = readStringOption(
  'project',
  'FIREBASE_PROJECT_ID',
  DEFAULT_PROJECT_ID
);
const region = readStringOption('region', 'FUNCTIONS_REGION', DEFAULT_REGION);
const functionUrl = readStringOption(
  'url',
  'PUSH_TOKEN_BACKFILL_FUNCTION_URL',
  `https://${region}-${projectId}.cloudfunctions.net/${FUNCTION_NAME}`
);
const idToken = readStringEnv('FIREBASE_ID_TOKEN');
const limit = readNumberOption('limit', 'PUSH_TOKEN_BACKFILL_LIMIT', 50, 1, 100);
const maxPages = readNumberOption(
  'maxPages',
  'PUSH_TOKEN_BACKFILL_MAX_PAGES',
  1,
  1,
  100
);
const dryRun = readBooleanOption(
  'dryRun',
  'PUSH_TOKEN_BACKFILL_DRY_RUN',
  true
);
let cursor = readStringOption(
  'cursor',
  'PUSH_TOKEN_BACKFILL_CURSOR',
  null
);

if (!idToken) {
  abort(
    'FIREBASE_ID_TOKEN ausente. Forneça um ID token administrativo antes do backfill.'
  );
}

let tokenClaims = null;

try {
  tokenClaims = assertFirebaseIdTokenProject(idToken, projectId);
} catch (error) {
  abort(error instanceof Error ? error.message : String(error));
}

if (!dryRun && process.env.PUSH_TOKEN_BACKFILL_CONFIRM_WRITE !== 'YES') {
  abort(
    'Escrita real bloqueada. Para dryRun=false, defina PUSH_TOKEN_BACKFILL_CONFIRM_WRITE=YES.'
  );
}

console.log('[push-token-backfill] Iniciando runner administrativo.', {
  projectId,
  region,
  functionUrl,
  dryRun,
  limit,
  maxPages,
  cursor,
  token: {
    aud: tokenClaims.aud,
    uid: tokenClaims.sub,
    email: tokenClaims.email ?? null,
    expiresAt: tokenClaims.exp
      ? new Date(tokenClaims.exp * 1000).toISOString()
      : null,
  },
});

let lastResult = null;

for (let page = 1; page <= maxPages; page += 1) {
  const payload = {
    limit,
    dryRun,
    startAfterPath: cursor,
  };

  console.log(`[push-token-backfill] Página ${page}/${maxPages}`, payload);

  const result = await callCallable(functionUrl, idToken, payload);
  lastResult = result;

  console.log('[push-token-backfill] Resultado:', result);

  cursor = normalizeOptionalString(result?.nextCursor);

  if (!result?.hasMore || !cursor) {
    console.log('[push-token-backfill] Encerrado: sem próxima página.');
    break;
  }
}

if (lastResult?.hasMore && cursor) {
  console.log('[push-token-backfill] Próxima continuação disponível:', {
    PUSH_TOKEN_BACKFILL_CURSOR: cursor,
    command:
      'node scripts/admin/run-push-token-ownership-backfill.mjs ' +
      `--limit=${limit} --cursor="${cursor}"`,
  });
}

if (dryRun) {
  console.log(
    '[push-token-backfill] Dry-run concluído. Nenhum ownership foi alterado.'
  );
}

console.log('[push-token-backfill] Runner finalizado.');

async function callCallable(url, token, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({data}),
  });

  const text = await response.text();
  const json = parseJson(text);

  if (!response.ok || json?.error) {
    const message = json?.error?.message || text || `HTTP ${response.status}`;
    throw new Error(`[push-token-backfill] Falha na callable: ${message}`);
  }

  return json?.result ?? json;
}

function parseArgs(values) {
  const parsed = new Map();

  for (const value of values) {
    if (!value.startsWith('--')) continue;

    const [rawKey, ...rawValue] = value.slice(2).split('=');
    const key = rawKey.trim();
    const optionValue = rawValue.length ? rawValue.join('=').trim() : 'true';

    if (key) parsed.set(key, optionValue);
  }

  return parsed;
}

function readStringEnv(name) {
  return normalizeOptionalString(process.env[name]);
}

function readStringOption(argName, envName, fallback) {
  return (
    normalizeOptionalString(args.get(argName)) ??
    readStringEnv(envName) ??
    fallback
  );
}

function readNumberOption(argName, envName, fallback, min, max) {
  const rawValue = args.get(argName) ?? process.env[envName];
  const parsed = Number(rawValue ?? fallback);

  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function readBooleanOption(argName, envName, fallback) {
  const rawValue = normalizeOptionalString(
    args.get(argName) ?? process.env[envName]
  );

  if (!rawValue) return fallback;

  if (['1', 'true', 'yes', 'sim'].includes(rawValue.toLowerCase())) {
    return true;
  }

  if (['0', 'false', 'no', 'nao', 'não'].includes(rawValue.toLowerCase())) {
    return false;
  }

  return fallback;
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length ? text : null;
}

function assertFirebaseIdTokenProject(token, expectedProjectId) {
  const claims = decodeJwtPayload(token);
  const expectedIssuer = `https://securetoken.google.com/${expectedProjectId}`;

  if (claims.aud !== expectedProjectId || claims.iss !== expectedIssuer) {
    throw new Error(
      [
        'Token Firebase pertence ao projeto errado.',
        `Esperado aud: ${expectedProjectId}`,
        `Recebido aud: ${claims.aud ?? '(vazio)'}`,
        `Esperado iss: ${expectedIssuer}`,
        `Recebido iss: ${claims.iss ?? '(vazio)'}`,
      ].join('\n')
    );
  }

  if (!claims.sub) {
    throw new Error('Token Firebase sem sub/uid. Gere um novo FIREBASE_ID_TOKEN.');
  }

  if (typeof claims.exp === 'number') {
    const nowInSeconds = Math.floor(Date.now() / 1000);
    if (claims.exp <= nowInSeconds) {
      throw new Error('FIREBASE_ID_TOKEN expirado. Gere um novo token.');
    }
  }

  return claims;
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');

  if (parts.length < 2 || !parts[1]) {
    throw new Error('FIREBASE_ID_TOKEN inválido. O valor não parece ser um JWT.');
  }

  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '='
  );

  try {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    throw new Error('FIREBASE_ID_TOKEN inválido. Não foi possível decodificar o JWT.');
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return null;
  }
}

function abort(message) {
  console.error(`[push-token-backfill] ${message}`);
  process.exit(1);
}
