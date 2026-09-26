// scripts/dev/functions-emulator-health.mjs
// -----------------------------------------------------------------------------
// FUNCTIONS EMULATOR CALLABLE HEALTH
// -----------------------------------------------------------------------------
// Valida a superfície HTTP real de uma callable sem executá-la.
// O preflight OPTIONS precisa ser atendido pelo runtime callable e devolver CORS.
// Porta 5001 aberta, por si só, não prova que a Function já foi descoberta.
// -----------------------------------------------------------------------------

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 5001;
const DEFAULT_PROJECT_ID = 'entretenimento-sexual';
const DEFAULT_REGION = 'us-central1';
const DEFAULT_ORIGIN = 'http://localhost:4200';
const DEFAULT_TIMEOUT_MS = 2_500;

function cleanSegment(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function cleanPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? port
    : DEFAULT_PORT;
}

function cleanTimeout(value) {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) && timeoutMs > 0
    ? Math.trunc(timeoutMs)
    : DEFAULT_TIMEOUT_MS;
}

export function buildFunctionsCallableUrl({
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  projectId = DEFAULT_PROJECT_ID,
  region = DEFAULT_REGION,
  name,
} = {}) {
  const callableName = cleanSegment(name);

  if (!/^[A-Za-z0-9_-]+$/.test(callableName)) {
    throw new Error(`Callable inválida: ${String(name ?? '')}`);
  }

  const safeHost = cleanSegment(host, DEFAULT_HOST);
  const safeProjectId = cleanSegment(projectId, DEFAULT_PROJECT_ID);
  const safeRegion = cleanSegment(region, DEFAULT_REGION);
  const safePort = cleanPort(port);

  return (
    `http://${safeHost}:${safePort}/` +
    `${encodeURIComponent(safeProjectId)}/` +
    `${encodeURIComponent(safeRegion)}/` +
    encodeURIComponent(callableName)
  );
}

export async function probeFunctionsCallable({
  name,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  projectId = DEFAULT_PROJECT_ID,
  region = DEFAULT_REGION,
  origin = DEFAULT_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const url = buildFunctionsCallableUrl({
    host,
    port,
    projectId,
    region,
    name,
  });
  const safeOrigin = cleanSegment(origin, DEFAULT_ORIGIN);
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    cleanTimeout(timeoutMs)
  );

  try {
    const response = await fetch(url, {
      method: 'OPTIONS',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Origin: safeOrigin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });

    const allowOrigin =
      response.headers.get('access-control-allow-origin') ?? '';
    const allowMethods =
      response.headers.get('access-control-allow-methods') ?? '';

    const originAllowed =
      allowOrigin === '*' ||
      allowOrigin
        .split(',')
        .map((value) => value.trim())
        .includes(safeOrigin);

    return {
      ready:
        response.status >= 200 &&
        response.status < 400 &&
        originAllowed,
      name: cleanSegment(name),
      url,
      status: response.status,
      allowOrigin,
      allowMethods,
      error: null,
    };
  } catch (error) {
    return {
      ready: false,
      name: cleanSegment(name),
      url,
      status: 0,
      allowOrigin: '',
      allowMethods: '',
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : String(error ?? 'unknown error'),
    };
  } finally {
    clearTimeout(timeout);
  }
}
