// scripts/quality/check-package-script-references.mjs
// -----------------------------------------------------------------------------
// PACKAGE SCRIPT REFERENCE INTEGRITY
// -----------------------------------------------------------------------------
// Garante que todo `npm run <script>` referenciado por package.json exista no
// package correto. Também entende `npm --prefix functions run <script>`.
//
// Evita que launchers/pre-scripts locais morram antes de iniciar os emuladores
// por referência a um script removido/renomeado.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');

function readPackage(packagePath) {
  return JSON.parse(fs.readFileSync(packagePath, 'utf8'));
}

const packages = new Map([
  ['root', {
    path: path.join(root, 'package.json'),
    label: 'package.json',
  }],
  ['functions', {
    path: path.join(root, 'functions', 'package.json'),
    label: 'functions/package.json',
  }],
]);

for (const packageInfo of packages.values()) {
  packageInfo.package = readPackage(packageInfo.path);
  packageInfo.scripts = packageInfo.package.scripts ?? {};
}

function parseRunReferences(command) {
  const references = [];
  const source = String(command ?? '');

  const regex =
    /\bnpm(?:\.cmd)?\s+(?:(?:--prefix|-C)\s+(?:"([^"]+)"|'([^']+)'|([^\s&|]+))\s+)?run\s+(?:--silent\s+)?([A-Za-z0-9:._-]+)/g;

  for (const match of source.matchAll(regex)) {
    const prefix = String(match[1] ?? match[2] ?? match[3] ?? '').trim();
    const scriptName = String(match[4] ?? '').trim();

    if (!scriptName) continue;

    references.push({
      prefix,
      scriptName,
      raw: match[0],
    });
  }

  return references;
}

function resolveTargetPackage(sourceKey, prefix) {
  if (!prefix) return sourceKey;

  const normalized = prefix
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');

  if (normalized === 'functions') return 'functions';

  return null;
}

const failures = [];

for (const [sourceKey, sourcePackage] of packages.entries()) {
  for (const [ownerScript, command] of Object.entries(sourcePackage.scripts)) {
    for (const reference of parseRunReferences(command)) {
      const targetKey = resolveTargetPackage(sourceKey, reference.prefix);

      if (!targetKey) {
        failures.push({
          source: sourcePackage.label,
          ownerScript,
          reference: reference.raw,
          reason:
            `prefixo npm não auditado automaticamente: ${reference.prefix}`,
        });
        continue;
      }

      const targetPackage = packages.get(targetKey);
      if (!Object.hasOwn(targetPackage.scripts, reference.scriptName)) {
        failures.push({
          source: sourcePackage.label,
          ownerScript,
          reference: reference.raw,
          reason:
            `script "${reference.scriptName}" ausente em ${targetPackage.label}`,
        });
      }
    }
  }
}

if (failures.length > 0) {
  console.error(
    `[package-scripts] Falha: ${failures.length} referência(s) npm run inválida(s).`
  );

  for (const failure of failures) {
    console.error(
      `  - ${failure.source} :: ${failure.ownerScript} :: ${failure.reference} -> ${failure.reason}`
    );
  }

  process.exit(1);
}

console.log(
  '[package-scripts] OK: todas as referências npm run apontam para scripts existentes.'
);
