// scripts/admin/run-community-member-count-reconcile.mjs
// -----------------------------------------------------------------------------
// ADMIN RUNNER - COMMUNITY MEMBER COUNT RECONCILIATION
// -----------------------------------------------------------------------------
// Dry-run é o padrão. Escrita real exige --dryRun=false e a variável
// COMMUNITY_MEMBER_COUNT_CONFIRM_WRITE=YES. Runtime real também exige App Check.
// -----------------------------------------------------------------------------

const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const DEFAULT_REGION = 'us-central1';
const FUNCTION_NAME = 'reconcileCommunityMemberCounts';
const args = parseArgs(process.argv.slice(2));

const projectId = readStringOption(
  'project',
  'FIREBASE_PROJECT_ID',
  DEFAULT_PROJECT_ID
);
const region = readStringOption('region', 'FUNCTIONS_REGION', DEFAULT_REGION);
const functionUrl = readStringOption(
  'url',
  'COMMUNITY_MEMBER_COUNT_FUNCTION_URL',
  `https://${region}-${projectId}.cloudfunctions.net/${FUNCTION_NAME}`
);
const idToken = readStringEnv('FIREBASE_ID_TOKEN');
const appCheckToken = readStringEnv('FIREBASE_APP_CHECK_TOKEN');
const limit = readNumberOption('limit', 'COMMUNITY_MEMBER_COUNT_LIMIT', 25, 1, 100);
const maxPages = readNumberOption(
  'maxPages',
  'COMMUNITY_MEMBER_COUNT_MAX_PAGES',
  1,
  1,
  50
);
const dryRun = readBooleanOption(
  'dryRun',
  'COMMUNITY_MEMBER_COUNT_DRY_RUN',
  true
);
let cursor = readStringOption(
  'cursor',
  'COMMUNITY_MEMBER_COUNT_CURSOR',
  null
);

if (!idToken) {
  abort('FIREBASE_ID_TOKEN ausente. Use um ID token de usuário administrativo.');
}

if (!appCheckToken) {
  abort('FIREBASE_APP_CHECK_TOKEN ausente. A callable de Comunidades exige App Check.');
}

assertFirebaseIdTokenProject(idToken, projectId);

if (!dryRun && process.env.COMMUNITY_MEMBER_COUNT_CONFIRM_WRITE !== 'YES') {
  abort(
    'Escrita bloqueada. Defina COMMUNITY_MEMBER_COUNT_CONFIRM_WRITE=YES para dryRun=false.'
  );
}

console.log('[community-member-count] Iniciando reconciliação.', {
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
    startAfterCommunityId: cursor,
  };

  console.log(`[community-member-count] Página ${page}/${maxPages}`, payload);
  const result = await callCallable(
    functionUrl,
    idToken,
    appCheckToken,
    payload
  );
  lastResult = result;
  console.log('[community-member-count] Resultado:', result);

  cursor = normalizeOptionalString(result?.nextCursor);
  if (!result?.hasMore || !cursor) break;
}

if (lastResult?.hasMore && cursor) {
  console.log('[community-member-count] Próxima continuação:', {
    COMMUNITY_MEMBER_COUNT_CURSOR: cursor,
    command:
      `node scripts/admin/run-community-member-count-reconcile.mjs `
      + `--limit=${limit} --cursor="${cursor}"`,
  });
}

console.log('[community-member-count] Runner finalizado.');

async function callCallable(url, token, appToken, data) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Firebase-AppCheck': appToken,
    },
    body: JSON.stringify({ data }),
  });
  const text = await response.text();
  const json = parseJson(text);

  if (!response.ok || json?.error) {
    const message = json?.error?.message || text || `HTTP ${response.status}`;
    throw new Error(`[community-member-count] Falha na callable: ${message}`);
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
  return normalizeOptionalString(args.get(argName))
    ?? readStringEnv(envName)
    ?? fallback;
}

function readNumberOption(argName, envName, fallback, min, max) {
  const rawValue = args.get(argName) ?? process.env[envName];
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function readBooleanOption(argName, envName, fallback) {
  const rawValue = normalizeOptionalString(args.get(argName) ?? process.env[envName]);
  if (!rawValue) return fallback;
  if (['1', 'true', 'yes', 'sim'].includes(rawValue.toLowerCase())) return true;
  if (['0', 'false', 'no', 'nao', 'não'].includes(rawValue.toLowerCase())) return false;
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
    abort('FIREBASE_ID_TOKEN pertence a outro projeto Firebase.');
  }

  if (!claims.sub) abort('FIREBASE_ID_TOKEN sem uid/sub.');
  if (
    typeof claims.exp === 'number'
    && claims.exp <= Math.floor(Date.now() / 1000)
  ) {
    abort('FIREBASE_ID_TOKEN expirado.');
  }
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2 || !parts[1]) abort('FIREBASE_ID_TOKEN inválido.');
  const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    '='
  );

  try {
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    abort('FIREBASE_ID_TOKEN não pôde ser decodificado.');
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
  console.error(`[community-member-count] ${message}`);
  process.exit(1);
}
