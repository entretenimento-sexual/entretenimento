// scripts/quality/check-auth-signout-boundary.mjs
// -----------------------------------------------------------------------------
// AUTH SIGNOUT BOUNDARY CHECK
// -----------------------------------------------------------------------------
// LogoutService é a única fronteira autorizada a importar/chamar signOut do
// Firebase Auth. O checker é intencionalmente dependency-free para também rodar
// cedo no Quality Gate, sem depender do parser TypeScript em runtime.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const appRoot = path.join(root, 'src', 'app');
const canonicalRelativePath = path.normalize(
  'src/app/core/services/autentication/auth/logout.service.ts'
);

function walkTypeScriptFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkTypeScriptFiles(absolutePath));
      continue;
    }

    if (
      entry.isFile()
      && entry.name.endsWith('.ts')
      && !entry.name.endsWith('.spec.ts')
      && !entry.name.endsWith('.test.ts')
    ) {
      files.push(absolutePath);
    }
  }

  return files;
}

function normalizeRelativePath(absolutePath) {
  return path.normalize(path.relative(root, absolutePath));
}

function findRawSignOutImports(source) {
  const findings = [];
  const directImport = /import\s*{[^}]*\bsignOut\b[^}]*}\s*from\s*['"](?:@angular\/fire\/auth|firebase\/auth)['"]/gms;

  for (const match of source.matchAll(directImport)) {
    findings.push(match.index ?? 0);
  }

  const namespaceImport = /import\s*\*\s*as\s*([A-Za-z_$][\w$]*)\s*from\s*['"](?:@angular\/fire\/auth|firebase\/auth)['"]/gm;

  for (const match of source.matchAll(namespaceImport)) {
    const namespace = match[1];
    if (!namespace) continue;

    const escapedNamespace = namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const callPattern = new RegExp(`\\b${escapedNamespace}\\.signOut\\s*\\(`, 'm');
    const callMatch = callPattern.exec(source);

    if (callMatch) {
      findings.push(callMatch.index);
    }
  }

  return findings;
}

function lineAndColumn(source, index) {
  const before = source.slice(0, index);
  const lines = before.split('\n');

  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

if (!fs.existsSync(appRoot)) {
  console.error(`[auth-boundary] Diretório não encontrado: ${appRoot}`);
  process.exit(1);
}

const violations = [];

for (const absolutePath of walkTypeScriptFiles(appRoot)) {
  const relativePath = normalizeRelativePath(absolutePath);
  if (relativePath === canonicalRelativePath) continue;

  const source = fs.readFileSync(absolutePath, 'utf8');

  for (const index of findRawSignOutImports(source)) {
    const position = lineAndColumn(source, index);
    violations.push(`${relativePath}:${position.line}:${position.column}`);
  }
}

if (violations.length > 0) {
  console.error('[auth-boundary] Firebase Auth signOut fora da fronteira canônica:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  console.error(
    '[auth-boundary] Use AuthFacade.logout$()/logout() ou LogoutService. '
      + 'Somente logout.service.ts pode importar/chamar Firebase signOut.'
  );
  process.exit(1);
}

console.log(
  '[auth-boundary] OK: Firebase signOut permanece exclusivo de LogoutService.'
);
