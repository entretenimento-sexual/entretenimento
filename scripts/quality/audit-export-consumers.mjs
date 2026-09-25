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

function exportedDeclarations(sourceFile) {
  const declarations = [];

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
      declarations.push({
        name: statement.name.text,
        kind: ts.SyntaxKind[statement.kind],
      });
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        declarations.push({
          name: declaration.name.text,
          kind: 'VariableDeclaration',
        });
      }
    }
  }

  return declarations.filter(
    (item, index, items) =>
      items.findIndex(
        (candidate) =>
          candidate.name === item.name && candidate.kind === item.kind
      ) === index
  );
}

function escapedName(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasWord(source, name) {
  return new RegExp(`\\b${escapedName(name)}\\b`).test(source);
}

function countWords(source, name) {
  return [
    ...source.matchAll(
      new RegExp(`\\b${escapedName(name)}\\b`, 'g')
    ),
  ].length;
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

const deadDeclarations = [];
const localOnlyExports = [];
const testOnlyExports = [];

for (const filePath of productionFiles) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  for (const declaration of exportedDeclarations(sourceFile)) {
    const { name, kind } = declaration;
    const productionConsumers = productionTexts
      .filter(
        (item) =>
          item.filePath !== filePath && hasWord(item.source, name)
      )
      .map((item) => relative(item.filePath));
    const testConsumers = testTexts
      .filter((item) => hasWord(item.source, name))
      .map((item) => relative(item.filePath));

    if (productionConsumers.length > 0) continue;

    if (testConsumers.length > 0) {
      testOnlyExports.push(
        `${relative(filePath)} :: ${kind} ${name} <- ${testConsumers.join(', ')}`
      );
      continue;
    }

    const localOccurrences = countWords(source, name);

    if (localOccurrences <= 1) {
      deadDeclarations.push(
        `${relative(filePath)} :: ${kind} ${name}`
      );
    } else {
      localOnlyExports.push(
        `${relative(filePath)} :: ${kind} ${name}`
      );
    }
  }
}

deadDeclarations.sort();
localOnlyExports.sort();
testOnlyExports.sort();

function printGroup(label, items) {
  if (items.length === 0) {
    console.log(`[export-consumers] ${label}: nenhum.`);
    return;
  }

  console.log(`[export-consumers] ${label}: ${items.length}`);
  for (const item of items) console.log(`  - ${item}`);
}

printGroup(
  'Declarações exportadas sem consumidor e sem uso local identificado',
  deadDeclarations
);
printGroup(
  'Exports usados somente dentro do próprio arquivo',
  localOnlyExports
);
printGroup(
  'Exports consumidos apenas por testes',
  testOnlyExports
);

if (strict && deadDeclarations.length > 0) {
  console.error(
    '[export-consumers] Falha: remova a declaração morta ou comprove um consumidor externo real antes de criar exceção.'
  );
  process.exit(1);
}

console.log(
  '[export-consumers] Auditoria de consumidores de exports concluída.'
);
