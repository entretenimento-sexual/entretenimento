// scripts/quality/classify-root-dependency-audit.mjs
// -----------------------------------------------------------------------------
// ROOT DEPENDENCY AUDIT CLASSIFIER
// -----------------------------------------------------------------------------
// Classifica findings do npm audit por:
// - direta vs transitiva;
// - runtime de produção vs build/test/dev;
// - fix disponível;
// sem alterar dependências.
//
// Uso:
//   node scripts/quality/classify-root-dependency-audit.mjs \
//     --audit logs/app-audit-all.json --lock package-lock.json
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

function arg(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1]
    ? process.argv[index + 1]
    : fallback;
}

const auditPath = arg('--audit');
const lockPath = arg('--lock', 'package-lock.json');
const failOn = arg('--fail-on');

if (!auditPath) {
  throw new Error('Informe --audit <arquivo.json>.');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function packageNameFromNodePath(nodePath) {
  const normalized = String(nodePath ?? '').replaceAll('\\', '/');
  const marker = '/node_modules/';
  const index = normalized.lastIndexOf(marker);
  const tail = index >= 0
    ? normalized.slice(index + marker.length)
    : normalized.replace(/^node_modules\//, '');

  if (tail.startsWith('@')) {
    return tail.split('/').slice(0, 2).join('/');
  }
  return tail.split('/')[0] ?? '';
}

const audit = readJson(auditPath);
const lock = readJson(lockPath);
const rootPackage = lock.packages?.[''] ?? {};
const directRuntime = new Set(Object.keys(rootPackage.dependencies ?? {}));
const directDev = new Set(Object.keys(rootPackage.devDependencies ?? {}));

const packageScopeByName = new Map();

for (const [location, meta] of Object.entries(lock.packages ?? {})) {
  if (!location || !location.includes('node_modules/')) continue;
  const name = packageNameFromNodePath(location);
  if (!name) continue;

  const current = packageScopeByName.get(name) ?? {
    runtimeNodes: 0,
    devNodes: 0,
  };

  if (meta?.dev === true) current.devNodes += 1;
  else current.runtimeNodes += 1;

  packageScopeByName.set(name, current);
}

function classifyScope(name, vulnerability) {
  const nodes = Array.isArray(vulnerability.nodes)
    ? vulnerability.nodes
    : [];

  let runtimeNodes = 0;
  let devNodes = 0;

  for (const node of nodes) {
    const meta = lock.packages?.[node];
    if (meta?.dev === true) devNodes += 1;
    else if (meta) runtimeNodes += 1;
  }

  if (nodes.length === 0) {
    const aggregate = packageScopeByName.get(name);
    runtimeNodes = aggregate?.runtimeNodes ?? 0;
    devNodes = aggregate?.devNodes ?? 0;
  }

  if (runtimeNodes > 0 && devNodes > 0) return 'mixed';
  if (runtimeNodes > 0) return 'runtime';
  if (devNodes > 0) return 'build-dev';
  return 'unknown';
}

function normalizeVia(via) {
  return (Array.isArray(via) ? via : []).map((entry) => {
    if (typeof entry === 'string') return entry;
    return {
      name: entry?.name ?? null,
      title: entry?.title ?? null,
      url: entry?.url ?? null,
      range: entry?.range ?? null,
      severity: entry?.severity ?? null,
    };
  });
}

const rows = Object.entries(audit.vulnerabilities ?? {})
  .map(([name, vulnerability]) => {
    const directKind = directRuntime.has(name)
      ? 'direct-runtime'
      : directDev.has(name)
        ? 'direct-dev'
        : 'transitive';

    return {
      name,
      severity: vulnerability.severity ?? 'unknown',
      directKind,
      scope: classifyScope(name, vulnerability),
      isDirect: vulnerability.isDirect === true,
      via: normalizeVia(vulnerability.via),
      effects: vulnerability.effects ?? [],
      range: vulnerability.range ?? null,
      nodes: vulnerability.nodes ?? [],
      fixAvailable: vulnerability.fixAvailable ?? false,
    };
  })
  .sort((a, b) => {
    const severityOrder = {critical: 5, high: 4, moderate: 3, low: 2, info: 1};
    const severityDelta =
      (severityOrder[b.severity] ?? 0) - (severityOrder[a.severity] ?? 0);
    if (severityDelta !== 0) return severityDelta;
    if (a.scope !== b.scope) return a.scope.localeCompare(b.scope);
    return a.name.localeCompare(b.name);
  });

const summary = {
  metadata: audit.metadata?.vulnerabilities ?? {},
  findings: rows.length,
  byScope: rows.reduce((acc, row) => {
    acc[row.scope] = (acc[row.scope] ?? 0) + 1;
    return acc;
  }, {}),
  byDirectKind: rows.reduce((acc, row) => {
    acc[row.directKind] = (acc[row.directKind] ?? 0) + 1;
    return acc;
  }, {}),
};

console.log('[dependency-audit] summary ' + JSON.stringify(summary));

for (const row of rows) {
  console.log('[dependency-audit] finding ' + JSON.stringify(row));
}

if (failOn) {
  const severityOrder = {
    info: 1,
    low: 2,
    moderate: 3,
    high: 4,
    critical: 5,
  };
  const threshold = severityOrder[String(failOn).toLowerCase()] ?? 0;

  if (!threshold) {
    throw new Error('Severidade inválida em --fail-on: ' + failOn);
  }

  const blocking = rows.filter(
    (row) => (severityOrder[row.severity] ?? 0) >= threshold
  );

  if (blocking.length > 0) {
    console.error(
      '[dependency-audit] blocking findings at ' + failOn + '+: '
      + blocking.length
    );
    process.exit(1);
  }
}
