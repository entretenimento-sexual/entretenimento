// scripts/quality/check-unused-production-dependencies.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const packageJson = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')
);
const dependencies = Object.keys(packageJson.dependencies ?? {});

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.angular') {
      return [];
    }
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const roots = [
  path.join(ROOT, 'src'),
  path.join(ROOT, 'scripts'),
  path.join(ROOT, 'config'),
  path.join(ROOT, '.github'),
];

const textExtensions = new Set([
  '.ts', '.js', '.mjs', '.cjs', '.html', '.css', '.scss', '.json', '.yml', '.yaml',
]);

const files = [
  ...roots.flatMap(walk),
  path.join(ROOT, 'angular.json'),
  path.join(ROOT, 'firebase.json'),
  path.join(ROOT, 'vitest-base.config.ts'),
  path.join(ROOT, 'vitest.angular.config.ts'),
  path.join(ROOT, 'eslint.config.mjs'),
].filter((file) => fs.existsSync(file) && textExtensions.has(path.extname(file)));

const corpus = files
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

const implicitRuntime = new Set([
  // Angular framework packages can be consumed indirectly by builders/framework.
  '@angular/compiler',
  // Bootstrap/ng-bootstrap peer at runtime.
  '@popperjs/core',
  // TypeScript helper runtime.
  'tslib',
]);

const unused = dependencies
  .filter((dependency) => !implicitRuntime.has(dependency))
  .filter((dependency) => !corpus.includes(dependency))
  .sort();

if (unused.length) {
  console.error('[production-dependencies] Dependências diretas sem referência no app/config:');
  for (const dependency of unused) console.error(` - ${dependency}`);
  process.exit(1);
}

console.log(
  `[production-dependencies] OK: ${dependencies.length} dependências diretas possuem uso explícito ou runtime implícito documentado.`
);
