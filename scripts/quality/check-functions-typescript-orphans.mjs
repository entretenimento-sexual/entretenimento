// scripts/quality/check-functions-typescript-orphans.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const FUNCTIONS_SRC = path.join(ROOT, 'functions/src');

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

const files = walk(FUNCTIONS_SRC)
  .filter((file) => file.endsWith('.ts'))
  .filter((file) => !file.endsWith('.test.ts'))
  .filter((file) => !file.endsWith('.spec.ts'));

const fileSet = new Set(files.map((file) => path.resolve(file)));

function resolveModule(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.ts`, path.join(base, 'index.ts')]) {
    const absolute = path.resolve(candidate);
    if (fileSet.has(absolute)) return absolute;
  }
  return null;
}

function specifiers(source) {
  const found = new Set();
  const patterns = [
    /(?:import|export)\s+(?:[^'"\n]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) found.add(match[1]);
  }
  return found;
}

const graph = new Map();
for (const file of files) {
  const deps = [];
  const source = fs.readFileSync(file, 'utf8');
  for (const specifier of specifiers(source)) {
    const resolved = resolveModule(file, specifier);
    if (resolved) deps.push(resolved);
  }
  graph.set(path.resolve(file), deps);
}

const roots = new Set([path.resolve(FUNCTIONS_SRC, 'index.ts')]);

// Maintenance/admin scripts may intentionally consume compiled modules directly
// instead of exposing them as deployed Functions. Treat those modules as roots.
for (const scriptFile of walk(path.join(ROOT, 'scripts'))) {
  if (!/\.(?:mjs|js|cjs)$/i.test(scriptFile)) continue;
  const source = fs.readFileSync(scriptFile, 'utf8');
  for (const match of source.matchAll(/functions[\\/]lib[\\/]([^'"]+?)\.js/g)) {
    const sourcePath = path.resolve(FUNCTIONS_SRC, `${match[1].replaceAll('\\\\', '/')}.ts`);
    if (fileSet.has(sourcePath)) roots.add(sourcePath);
  }
}

const reachable = new Set();
const stack = [...roots];
while (stack.length) {
  const current = stack.pop();
  if (!current || reachable.has(current)) continue;
  reachable.add(current);
  for (const dep of graph.get(current) ?? []) {
    if (!reachable.has(dep)) stack.push(dep);
  }
}

const orphaned = files
  .map((file) => path.resolve(file))
  .filter((file) => !reachable.has(file))
  .map(rel)
  .sort();

if (orphaned.length) {
  console.error('[functions-orphans] Arquivos Functions fora do grafo de export/admin:');
  for (const file of orphaned) console.error(` - ${file}`);
  process.exit(1);
}

console.log(
  `[functions-orphans] OK: ${reachable.size} módulos de produção alcançáveis; nenhum arquivo órfão.`
);
