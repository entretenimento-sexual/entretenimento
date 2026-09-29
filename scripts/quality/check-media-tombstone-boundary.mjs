// scripts/quality/check-media-tombstone-boundary.mjs
// -----------------------------------------------------------------------------
// LEGACY MEDIA TOMBSTONE BOUNDARY
// -----------------------------------------------------------------------------
// Os antigos callables de "unpublish" permanecem exportados apenas para clientes
// distribuídos antes da retirada da semântica publicada -> privada.
//
// Contrato:
// - endpoint sempre fail-closed;
// - toda chamada gera telemetria privacy-minimized;
// - nenhum consumidor novo pode surgir no monorepo;
// - data-alvo de retirada: 2026-12-31;
// - remoção depende de zero chamadas observadas + zero consumidores conhecidos.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TARGET_REMOVAL_DATE = '2026-12-31';

const tombstones = [
  {
    exportName: 'unpublishPhoto',
    handler: 'functions/src/media/application/legacy-unpublish-photo.handler.ts',
  },
  {
    exportName: 'unpublishVideo',
    handler: 'functions/src/media/application/legacy-unpublish-video.handler.ts',
  },
];

const allowedReferences = new Set([
  'functions/src/media/index.ts',
  'functions/src/media/application/legacy-media-tombstone.telemetry.ts',
  ...tombstones.map((entry) => entry.handler),
]);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[media-tombstone] ' + label + ': ' + fragment);
  }
}

function collectFiles(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];

  const result = [];
  for (const entry of fs.readdirSync(absoluteDir, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      result.push(...collectFiles(relativePath));
      continue;
    }
    if (/\.(?:ts|js|mjs|html)$/.test(entry.name)) {
      result.push(relativePath);
    }
  }
  return result;
}

const telemetry = read(
  'functions/src/media/application/legacy-media-tombstone.telemetry.ts'
);
for (const fragment of [
  'LEGACY_MEDIA_TOMBSTONE_TARGET_REMOVAL_DATE',
  `= '${TARGET_REMOVAL_DATE}'`,
  'zero_observed_calls_and_zero_repo_consumers',
  "logger.warn('[legacyMediaTombstone]'",
]) {
  requireIncludes(telemetry, fragment, 'tombstone telemetry contract drift');
}

for (const tombstone of tombstones) {
  const handler = read(tombstone.handler);
  for (const fragment of [
    'API TOMBSTONE',
    'Data-alvo de retirada: 2026-12-31.',
    'logLegacyMediaTombstoneUse',
    `logLegacyMediaTombstoneUse('${tombstone.exportName}', 'unauthenticated')`,
    `logLegacyMediaTombstoneUse('${tombstone.exportName}', 'invalid_argument')`,
    `logLegacyMediaTombstoneUse('${tombstone.exportName}', 'permission_denied')`,
    `logLegacyMediaTombstoneUse('${tombstone.exportName}', 'semantic_rejected')`,
    "'failed-precondition'",
  ]) {
    requireIncludes(
      handler,
      fragment,
      tombstone.exportName + ' tombstone contract drift'
    );
  }
}

const sourceFiles = [
  ...collectFiles('src/app'),
  ...collectFiles('functions/src'),
];

const unexpectedConsumers = [];
for (const relativePath of sourceFiles) {
  if (allowedReferences.has(relativePath)) continue;
  const source = read(relativePath);
  for (const tombstone of tombstones) {
    if (source.includes(tombstone.exportName)) {
      unexpectedConsumers.push(
        relativePath + ' -> ' + tombstone.exportName
      );
    }
  }
}

if (unexpectedConsumers.length > 0) {
  console.error(
    '[media-tombstone] Consumidores internos encontrados para APIs tombstone:'
  );
  for (const consumer of unexpectedConsumers) {
    console.error('- ' + consumer);
  }
  console.error(
    '[media-tombstone] Não adicione novos consumidores; migre para edição/exclusão canônicas.'
  );
  process.exit(1);
}

console.log(
  '[media-tombstone] OK: unpublishPhoto/unpublishVideo são tombstones fail-closed, ' +
    'instrumentados, sem consumidor interno e com retirada alvo em ' +
    TARGET_REMOVAL_DATE +
    ' condicionada a zero chamadas observadas.'
);
