// scripts/quality/check-production-orphans.mjs
// -----------------------------------------------------------------------------
// PRODUCTION ORPHAN CHECK
// -----------------------------------------------------------------------------
// Detecta arquivos produtivos Angular que não pertencem ao grafo carregável da
// aplicação e assets de componente sem referência. Não tenta decidir se um
// domínio legado ainda pode ser removido; isso continua sob checks específicos
// (ex.: room:deprecation-boundary:check).
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..', '..');
const strict = process.argv.includes('--strict');

function posix(filePath) {
  return path.relative(root, filePath).replaceAll('\\', '/');
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];

  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(absolute));
    } else if (entry.isFile()) {
      found.push(absolute);
    }
  }
  return found;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isProductionTypeScript(filePath) {
  if (!filePath.endsWith('.ts') || filePath.endsWith('.d.ts')) return false;
  if (/\.(?:spec|test)\.ts$/i.test(filePath)) return false;
  return !filePath.includes(`${path.sep}visual-validation${path.sep}`);
}

function collectReplacementRoots(angularConfig) {
  const roots = new Set();
  const build = angularConfig.projects?.entretenimento?.architect?.build;

  const collect = (configuration) => {
    for (const replacement of configuration?.fileReplacements ?? []) {
      if (typeof replacement?.with === 'string' && replacement.with.endsWith('.ts')) {
        roots.add(path.resolve(root, replacement.with));
      }
    }
  };

  collect(build?.options);
  for (const configuration of Object.values(build?.configurations ?? {})) {
    collect(configuration);
  }

  return roots;
}

function moduleSpecifiers(sourceFile) {
  const specifiers = [];

  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node)
      && node.arguments.length > 0
      && ts.isStringLiteralLike(node.arguments[0])
      && (
        node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (
          ts.isIdentifier(node.expression)
          && node.expression.text === 'require'
        )
      )
    ) {
      specifiers.push(node.arguments[0].text);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return specifiers;
}

const configPath = path.join(root, 'tsconfig.app.json');
const rawConfig = ts.readConfigFile(configPath, ts.sys.readFile);
if (rawConfig.error) {
  throw new Error(
    ts.flattenDiagnosticMessageText(rawConfig.error.messageText, '\n')
  );
}

const parsedConfig = ts.parseJsonConfigFileContent(
  rawConfig.config,
  ts.sys,
  root,
  undefined,
  configPath
);

const angularConfig = readJson(path.join(root, 'angular.json'));
const appRoot = path.join(root, 'src', 'app');
const allAppFiles = walk(appRoot);
const productionTs = allAppFiles.filter(isProductionTypeScript);
const productionSet = new Set(productionTs.map((filePath) => path.normalize(filePath)));

const roots = new Set([
  path.join(root, 'src', 'main.ts'),
  ...collectReplacementRoots(angularConfig),
]);

const reachable = new Set();
const queue = [...roots]
  .map((filePath) => path.normalize(filePath))
  .filter((filePath) => fs.existsSync(filePath));

while (queue.length > 0) {
  const filePath = queue.shift();
  if (!filePath || reachable.has(filePath)) continue;

  reachable.add(filePath);

  const sourceText = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  for (const specifier of moduleSpecifiers(sourceFile)) {
    const resolved = ts.resolveModuleName(
      specifier,
      filePath,
      parsedConfig.options,
      ts.sys
    ).resolvedModule?.resolvedFileName;

    if (!resolved) continue;

    const normalized = path.normalize(resolved);
    if (
      normalized.startsWith(path.join(root, 'src') + path.sep)
      && normalized.endsWith('.ts')
      && !normalized.endsWith('.d.ts')
      && !reachable.has(normalized)
    ) {
      queue.push(normalized);
    }
  }
}

const tsOrphans = productionTs
  .filter((filePath) => !reachable.has(path.normalize(filePath)))
  .map(posix)
  .sort();

// -----------------------------------------------------------------------------
// HTML/CSS de componentes
// -----------------------------------------------------------------------------

const componentAssetRefs = new Set();

function registerRelativeAsset(tsFile, value) {
  if (!value || /^https?:/i.test(value)) return;
  const absolute = path.normalize(path.resolve(path.dirname(tsFile), value));
  if (absolute.startsWith(appRoot + path.sep)) {
    componentAssetRefs.add(absolute);
  }
}

for (const tsFile of allAppFiles.filter((filePath) => filePath.endsWith('.ts'))) {
  const source = fs.readFileSync(tsFile, 'utf8');

  for (const match of source.matchAll(
    /\b(?:templateUrl|styleUrl)\s*:\s*['"]([^'"]+)['"]/g
  )) {
    registerRelativeAsset(tsFile, match[1]);
  }

  for (const match of source.matchAll(
    /\bstyleUrls\s*:\s*\[([\s\S]*?)\]/g
  )) {
    for (const item of match[1].matchAll(/['"]([^'"]+\.css)['"]/g)) {
      registerRelativeAsset(tsFile, item[1]);
    }
  }
}

const globalStyles =
  angularConfig.projects?.entretenimento?.architect?.build?.options?.styles ?? [];

for (const style of globalStyles) {
  if (typeof style !== 'string' || !style.startsWith('src/')) continue;
  componentAssetRefs.add(path.normalize(path.resolve(root, style)));
}

const cssFiles = allAppFiles.filter((filePath) => filePath.endsWith('.css'));

for (const cssFile of cssFiles) {
  const source = fs.readFileSync(cssFile, 'utf8');
  for (const match of source.matchAll(/@import\s+(?:url\()?['"]([^'"]+)['"]/g)) {
    const imported = match[1];
    if (!imported || /^https?:/i.test(imported)) continue;
    componentAssetRefs.add(
      path.normalize(path.resolve(path.dirname(cssFile), imported))
    );
  }
}

const assetOrphans = allAppFiles
  .filter(
    (filePath) =>
      (filePath.endsWith('.html') || filePath.endsWith('.css'))
      && !componentAssetRefs.has(path.normalize(filePath))
  )
  .map(posix)
  .sort();

// Visual-validation possui entradas próprias nos workflows e replacements.
// Não é runtime de produção e, por isso, não entra como "órfão produtivo".
const meaningfulTsOrphans = tsOrphans.filter(
  (filePath) => !filePath.includes('/visual-validation/')
);
const meaningfulAssetOrphans = assetOrphans.filter(
  (filePath) => !filePath.includes('/visual-validation/')
);

function printGroup(label, items) {
  if (items.length === 0) {
    console.log(`[production-orphans] ${label}: nenhum.`);
    return;
  }

  console.log(`[production-orphans] ${label}: ${items.length}`);
  for (const item of items) console.log(`  - ${item}`);
}

printGroup('TypeScript fora do grafo carregável', meaningfulTsOrphans);
printGroup('HTML/CSS sem referência declarada', meaningfulAssetOrphans);

if (
  strict
  && (meaningfulTsOrphans.length > 0 || meaningfulAssetOrphans.length > 0)
) {
  console.error(
    '[production-orphans] Falha: remova o código órfão ou torne sua entrada explícita.'
  );
  process.exit(1);
}

console.log(
  '[production-orphans] Auditoria concluída; arquivos de visual-validation são tratados por seus próprios harnesses.'
);
