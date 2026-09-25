// scripts/quality/check-typescript-orphans.mjs
// -----------------------------------------------------------------------------
// Detecta arquivos TypeScript de produção que não participam do grafo do app.
// Não tenta decidir sobre specs nem arquivos de ambiente substituídos pelo CLI.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return [full];
  });
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function isProductionTs(file) {
  const normalized = rel(file);
  return normalized.endsWith('.ts')
    && !normalized.endsWith('.spec.ts')
    && !normalized.endsWith('.d.ts')
    && !normalized.includes('/test/')
    && !normalized.endsWith('.legacy.ts');
}

const allFiles = walk(SRC).filter(isProductionTs);
const fileSet = new Set(allFiles.map((file) => path.resolve(file)));

const aliasPrefixes = new Map([
  ['src/', path.join(ROOT, 'src')],
  ['@app/', path.join(ROOT, 'src/app')],
  ['@core/', path.join(ROOT, 'src/app/core')],
  ['@shared/', path.join(ROOT, 'src/app/shared')],
  ['@env/', path.join(ROOT, 'src/environments')],
  ['@store/', path.join(ROOT, 'src/app/store')],
]);

function resolveFile(base) {
  const candidates = [
    base,
    `${base}.ts`,
    path.join(base, 'index.ts'),
  ];

  for (const candidate of candidates) {
    const absolute = path.resolve(candidate);
    if (fileSet.has(absolute)) return absolute;
  }

  return null;
}

function resolveSpecifier(fromFile, specifier) {
  if (specifier.startsWith('.')) {
    return resolveFile(path.resolve(path.dirname(fromFile), specifier));
  }

  for (const [prefix, target] of aliasPrefixes) {
    if (specifier.startsWith(prefix)) {
      return resolveFile(path.join(target, specifier.slice(prefix.length)));
    }
  }

  return null;
}

function importSpecifiers(source) {
  const found = new Set();
  const staticPattern = /(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicPattern = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const pattern of [staticPattern, dynamicPattern]) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      found.add(match[1]);
    }
  }

  return found;
}

const graph = new Map();
for (const file of allFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const dependencies = [];

  for (const specifier of importSpecifiers(source)) {
    const resolved = resolveSpecifier(file, specifier);
    if (resolved) dependencies.push(resolved);
  }

  graph.set(path.resolve(file), dependencies);
}

const roots = new Set();
const main = path.join(ROOT, 'src/main.ts');
if (fs.existsSync(main)) roots.add(path.resolve(main));

const angularJsonPath = path.join(ROOT, 'angular.json');
if (fs.existsSync(angularJsonPath)) {
  const angularJson = JSON.parse(fs.readFileSync(angularJsonPath, 'utf8'));
  const serialized = JSON.stringify(angularJson);
  const replacementPattern = /"with":"([^"]+\.ts)"/g;
  let match;
  while ((match = replacementPattern.exec(serialized)) !== null) {
    const file = path.resolve(ROOT, match[1]);
    if (fileSet.has(file)) roots.add(file);
  }
}

const reachable = new Set();
const stack = [...roots];
while (stack.length) {
  const current = stack.pop();
  if (!current || reachable.has(current)) continue;
  reachable.add(current);
  for (const dependency of graph.get(current) ?? []) {
    if (!reachable.has(dependency)) stack.push(dependency);
  }
}

const intentionalStandalone = new Set([
  // Arquivos de ambiente alternativos são selecionados pelo Angular CLI.
  ...allFiles
    .filter((file) => /^src\/environments\/environment\.[^/]+\.ts$/.test(rel(file)))
    .map((file) => path.resolve(file)),
]);

const orphaned = allFiles
  .map((file) => path.resolve(file))
  .filter((file) => !reachable.has(file) && !intentionalStandalone.has(file))
  .map(rel)
  .sort();

if (orphaned.length > 0) {
  console.error('[typescript-orphans] Arquivos de produção fora do grafo do app:');
  for (const file of orphaned) console.error(` - ${file}`);
  process.exit(1);
}

console.log(
  `[typescript-orphans] OK: ${reachable.size} arquivos TypeScript alcançáveis; nenhum arquivo de produção órfão.`
);
