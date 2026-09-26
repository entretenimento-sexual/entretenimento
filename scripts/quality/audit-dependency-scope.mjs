import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const strict = process.argv.includes('--strict');

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      [
        '.git',
        '.angular',
        'coverage',
        'dist',
        'lib',
        'node_modules',
        'out-tsc',
        'tmp',
      ].includes(entry.name)
    ) {
      continue;
    }

    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(absolute));
    else if (entry.isFile()) found.push(absolute);
  }

  return found;
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const textExtensions = new Set([
  '.cmd',
  '.css',
  '.html',
  '.js',
  '.json',
  '.mjs',
  '.ps1',
  '.scss',
  '.sh',
  '.ts',
  '.yaml',
  '.yml',
]);

const textFiles = walk(root).filter((filePath) =>
  textExtensions.has(path.extname(filePath).toLowerCase())
);

const texts = textFiles
  .map((filePath) => ({
    filePath,
    relative: relative(filePath),
    source: fs.readFileSync(filePath, 'utf8'),
  }))
  .filter(
    ({ relative: relativePath }) =>
      relativePath !== 'package.json'
      && relativePath !== 'package-lock.json'
      && !relativePath.startsWith('docs/')
  );

function dependencyPatterns(packageName) {
  return [
    `'${packageName}'`,
    `"${packageName}"`,
    `'${packageName}/`,
    `"${packageName}/`,
    `node_modules/${packageName}/`,
  ];
}

function references(packageName) {
  const patterns = dependencyPatterns(packageName);
  return texts.filter(({ source }) =>
    patterns.some((pattern) => source.includes(pattern))
  );
}

function isTestPath(relativePath) {
  return /\.(?:spec|test)\.[cm]?[jt]s$/i.test(relativePath)
    || relativePath.startsWith('src/test/')
    || relativePath.startsWith('scripts/tests/')
    || relativePath.includes('/test-fixtures/');
}

function isAppRuntimePath(relativePath) {
  if (isTestPath(relativePath)) return false;
  if (relativePath.startsWith('src/')) return true;
  return relativePath === 'angular.json';
}

const pkg = readJson(path.join(root, 'package.json'));
const lock = readJson(path.join(root, 'package-lock.json'));
const dependencies = Object.keys(pkg.dependencies ?? {});

function requiredPeerOfRuntimeDependency(packageName) {
  return dependencies.some((directDependency) => {
    if (directDependency === packageName) return false;

    const directRefs = references(directDependency).filter(
      ({ relative: relativePath }) => isAppRuntimePath(relativePath)
    );
    if (directRefs.length === 0) return false;

    const entry = lock.packages?.[`node_modules/${directDependency}`];
    const peerRange = entry?.peerDependencies?.[packageName];

    return !!peerRange
      && entry?.peerDependenciesMeta?.[packageName]?.optional !== true;
  });
}

const indirectRuntimeDependencies = new Set([
  '@angular/animations',
  'tslib',
]);

const scopedCandidates = [];

for (const packageName of dependencies) {
  if (
    indirectRuntimeDependencies.has(packageName)
    || requiredPeerOfRuntimeDependency(packageName)
  ) {
    continue;
  }

  const refs = references(packageName);
  const runtimeRefs = refs.filter(
    ({ relative: relativePath }) => isAppRuntimePath(relativePath)
  );

  if (runtimeRefs.length > 0) continue;

  const categories = new Set();

  for (const { relative: relativePath } of refs) {
    if (relativePath.startsWith('functions/')) {
      categories.add('functions');
    } else if (isTestPath(relativePath)) {
      categories.add('tests');
    } else if (
      relativePath.startsWith('scripts/')
      || relativePath.startsWith('.github/')
    ) {
      categories.add('tooling');
    } else {
      categories.add('other');
    }
  }

  scopedCandidates.push(
    `${packageName} :: ${
      categories.size > 0
        ? [...categories].sort().join('+')
        : 'sem referência fora do manifesto'
    }`
  );
}

scopedCandidates.sort();

if (scopedCandidates.length === 0) {
  console.log(
    '[dependency-scope] Dependências de produção sem consumidor no runtime Angular: nenhuma.'
  );
} else {
  console.log(
    `[dependency-scope] Dependências de produção sem consumidor no runtime Angular: ${scopedCandidates.length}`
  );
  for (const candidate of scopedCandidates) console.log(`  - ${candidate}`);
}

if (strict && scopedCandidates.length > 0) {
  console.error(
    '[dependency-scope] Falha: dependência em dependencies sem consumidor do runtime Angular; mova para devDependencies, remova ou documente peer/runtime indireto explícito.'
  );
  process.exit(1);
}

console.log(
  '[dependency-scope] Auditoria de escopo de dependências concluída.'
);
