import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const strict = process.argv.includes('--strict');
const srcRoot = path.join(root, 'src');

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(absolute));
    else if (entry.isFile()) found.push(absolute);
  }
  return found;
}

function relative(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '');
}

const externalClassPrefixes = [
  'cdk-',
  'mat-',
  'mat-mdc-',
  'mdc-',
  'ng-',
  'ngb-',
  'fa-',
];

function isExternalGeneratedClass(className) {
  return externalClassPrefixes.some(
    (prefix) => className.startsWith(prefix)
  );
}

const sourceFiles = walk(srcRoot);
const cssFiles = sourceFiles.filter((filePath) => filePath.endsWith('.css'));
const consumerTexts = sourceFiles
  .filter((filePath) => {
    if (!/\.(?:html|ts)$/i.test(filePath)) return false;
    if (/\.(?:spec|test)\.ts$/i.test(filePath)) return false;
    if (filePath.includes(`${path.sep}test${path.sep}`)) return false;
    return !filePath.includes(
      `${path.sep}visual-validation${path.sep}`
    );
  })
  .map((filePath) => ({
    filePath,
    source: fs.readFileSync(filePath, 'utf8'),
  }));

const candidates = [];

for (const cssFile of cssFiles) {
  const source = stripComments(fs.readFileSync(cssFile, 'utf8'));
  const classNames = new Set();

  for (
    const match of source.matchAll(/\.([_a-zA-Z][_a-zA-Z0-9-]*)/g)
  ) {
    const className = match[1];
    if (!className || isExternalGeneratedClass(className)) continue;
    classNames.add(className);
  }

  for (const className of classNames) {
    const referenced = consumerTexts.some(({ source: consumer }) =>
      consumer.includes(className)
    );
    if (!referenced) {
      candidates.push(`${relative(cssFile)} :: .${className}`);
    }
  }
}

candidates.sort();

if (candidates.length === 0) {
  console.log(
    '[css-selectors] Seletores de classe sem referência textual: nenhum.'
  );
} else {
  console.log(
    `[css-selectors] Seletores de classe sem referência textual: ${candidates.length}`
  );
  for (const candidate of candidates) console.log(`  - ${candidate}`);
}

if (strict && candidates.length > 0) {
  console.error(
    '[css-selectors] Falha: confirme o consumidor dinâmico ou remova o seletor antes de criar exceção explícita.'
  );
  process.exit(1);
}

console.log(
  '[css-selectors] Auditoria conservadora de seletores concluída.'
);
