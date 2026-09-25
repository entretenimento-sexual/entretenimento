import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const strict = process.argv.includes('--strict');
const appRoot = path.join(root, 'src', 'app');

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

function isTestFile(filePath) {
  return /\.(?:spec|test)\.ts$/i.test(filePath)
    || filePath.includes(`${path.sep}test${path.sep}`);
}

function isProductionTs(filePath) {
  return filePath.endsWith('.ts')
    && !filePath.endsWith('.d.ts')
    && !isTestFile(filePath)
    && !filePath.includes(`${path.sep}visual-validation${path.sep}`);
}

function hasExportModifier(node) {
  return node.modifiers?.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
  ) === true;
}

function declarationNames(sourceFile) {
  const names = [];
  for (const statement of sourceFile.statements) {
    if (!hasExportModifier(statement)) continue;

    if (
      (
        ts.isClassDeclaration(statement)
        || ts.isFunctionDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement)
        || ts.isEnumDeclaration(statement)
      )
      && statement.name
    ) {
      names.push(statement.name.text);
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    }
  }
  return [...new Set(names)];
}

function wordPattern(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`);
}

const allTs = walk(appRoot).filter(
  (filePath) => filePath.endsWith('.ts') && !filePath.endsWith('.d.ts')
);
const productionFiles = allTs.filter(isProductionTs);
const testFiles = allTs.filter(isTestFile);
const productionTexts = productionFiles.map((filePath) => ({
  filePath,
  source: fs.readFileSync(filePath, 'utf8'),
}));
const testTexts = testFiles.map((filePath) => ({
  filePath,
  source: fs.readFileSync(filePath, 'utf8'),
}));

const unconsumed = [];
const testOnly = [];

for (const filePath of productionFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  for (const name of declarationNames(sourceFile)) {
    const pattern = wordPattern(name);
    const productionConsumers = productionTexts
      .filter(
        (item) => item.filePath !== filePath && pattern.test(item.source)
      )
      .map((item) => relative(item.filePath));
    const testConsumers = testTexts
      .filter((item) => pattern.test(item.source))
      .map((item) => relative(item.filePath));

    if (productionConsumers.length === 0 && testConsumers.length === 0) {
      unconsumed.push(`${relative(filePath)} :: ${name}`);
    } else if (
      productionConsumers.length === 0
      && testConsumers.length > 0
    ) {
      testOnly.push(
        `${relative(filePath)} :: ${name} <- ${testConsumers.join(', ')}`
      );
    }
  }
}

unconsumed.sort();
testOnly.sort();

function printGroup(label, items) {
  if (items.length === 0) {
    console.log(`[export-consumers] ${label}: nenhum.`);
    return;
  }

  console.log(`[export-consumers] ${label}: ${items.length}`);
  for (const item of items) console.log(`  - ${item}`);
}

printGroup(
  'Exports Angular sem consumidor externo identificado',
  unconsumed
);
printGroup(
  'Exports Angular consumidos apenas por testes',
  testOnly
);

if (strict && unconsumed.length > 0) {
  console.error(
    '[export-consumers] Falha: remova o export desnecessário ou documente uma entrada externa real antes de criar exceção.'
  );
  process.exit(1);
}

console.log(
  '[export-consumers] Auditoria de consumidores de exports concluída.'
);
