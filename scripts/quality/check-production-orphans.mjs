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


// -----------------------------------------------------------------------------
// TEST SUPPORT: helpers/stubs sem consumidor nos specs ativos
// -----------------------------------------------------------------------------

const testRoot = path.join(root, 'src', 'test');
const allSourceTs = walk(path.join(root, 'src')).filter(
  (filePath) => filePath.endsWith('.ts') && !filePath.endsWith('.d.ts')
);
const specRoots = allSourceTs.filter((filePath) =>
  /\.(?:spec|test)\.ts$/i.test(filePath)
);
const configuredTestSetup = path.join(testRoot, 'setup-vitest.ts');

const specConfigPath = path.join(root, 'tsconfig.spec.json');
const specRawConfig = ts.readConfigFile(specConfigPath, ts.sys.readFile);
if (specRawConfig.error) {
  throw new Error(
    ts.flattenDiagnosticMessageText(specRawConfig.error.messageText, '\n')
  );
}
const specParsedConfig = ts.parseJsonConfigFileContent(
  specRawConfig.config,
  ts.sys,
  root,
  undefined,
  specConfigPath
);

const reachableTestSupport = new Set();
const testQueue = [...specRoots, configuredTestSetup]
  .map((filePath) => path.normalize(filePath))
  .filter((filePath) => fs.existsSync(filePath));

while (testQueue.length > 0) {
  const filePath = path.normalize(testQueue.shift());
  if (!filePath || reachableTestSupport.has(filePath)) continue;

  reachableTestSupport.add(filePath);
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
      specParsedConfig.options,
      ts.sys
    ).resolvedModule?.resolvedFileName;
    if (!resolved) continue;

    const normalized = path.normalize(resolved);
    if (
      normalized.startsWith(testRoot + path.sep)
      && normalized.endsWith('.ts')
      && !normalized.endsWith('.d.ts')
      && !reachableTestSupport.has(normalized)
    ) {
      testQueue.push(normalized);
    }
  }
}

const testSupportOrphans = walk(testRoot)
  .filter(
    (filePath) =>
      filePath.endsWith('.ts')
      && !filePath.endsWith('.d.ts')
      && !/\.(?:spec|test)\.ts$/i.test(filePath)
      && path.normalize(filePath) !== path.normalize(configuredTestSetup)
      && !reachableTestSupport.has(path.normalize(filePath))
  )
  .map(posix)
  .sort();

// -----------------------------------------------------------------------------
// FUNCTIONS: arquivos produtivos que não chegam ao export raiz
// -----------------------------------------------------------------------------

const functionsSourceRoot = path.join(root, 'functions', 'src');
const functionsFiles = walk(functionsSourceRoot);
const functionsProductionTs = functionsFiles.filter(isProductionTypeScript);
const functionsConfigPath = path.join(root, 'functions', 'tsconfig.json');
const functionsRawConfig = ts.readConfigFile(functionsConfigPath, ts.sys.readFile);
if (functionsRawConfig.error) {
  throw new Error(
    ts.flattenDiagnosticMessageText(functionsRawConfig.error.messageText, '\n')
  );
}
const functionsParsedConfig = ts.parseJsonConfigFileContent(
  functionsRawConfig.config,
  ts.sys,
  path.dirname(functionsConfigPath),
  undefined,
  functionsConfigPath
);
const functionsReachable = new Set();
const functionsQueue = [path.join(functionsSourceRoot, 'index.ts')];

while (functionsQueue.length > 0) {
  const filePath = path.normalize(functionsQueue.shift());
  if (!filePath || functionsReachable.has(filePath) || !fs.existsSync(filePath)) {
    continue;
  }

  functionsReachable.add(filePath);
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
      functionsParsedConfig.options,
      ts.sys
    ).resolvedModule?.resolvedFileName;
    if (!resolved) continue;

    const normalized = path.normalize(resolved);
    if (
      normalized.startsWith(functionsSourceRoot + path.sep)
      && normalized.endsWith('.ts')
      && !normalized.endsWith('.d.ts')
      && !functionsReachable.has(normalized)
    ) {
      functionsQueue.push(normalized);
    }
  }
}

const functionsOperationalPolicyArtifacts = new Set([
  posix(path.join(
    functionsSourceRoot,
    'community-boost/community-boost-cost-calibration.policy.ts'
  )),
  posix(path.join(
    functionsSourceRoot,
    'community/community-business-official-calibration.policy.ts'
  )),
  posix(path.join(
    functionsSourceRoot,
    'shared/observability/operational-cost-baseline.policy.ts'
  )),
]);

const functionOrphans = functionsProductionTs
  .filter((filePath) => !functionsReachable.has(path.normalize(filePath)))
  .map(posix)
  .filter((filePath) => !functionsOperationalPolicyArtifacts.has(filePath))
  .sort();

// -----------------------------------------------------------------------------
// ASSETS ESTÁTICOS: arquivos copiados para Hosting sem referência textual
// -----------------------------------------------------------------------------

const ignoredAuditDirectories = new Set([
  '.git',
  '.angular',
  'coverage',
  'dist',
  'lib',
  'node_modules',
  'out-tsc',
  'tmp',
]);

function walkAuditText(directory) {
  if (!fs.existsSync(directory)) return [];
  const found = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredAuditDirectories.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkAuditText(absolute));
    } else if (entry.isFile()) {
      found.push(absolute);
    }
  }

  return found;
}

const auditTextExtensions = new Set([
  '.cmd', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.scss',
  '.sh', '.ts', '.txt', '.yaml', '.yml',
]);

const auditTextFiles = walkAuditText(root).filter((filePath) =>
  auditTextExtensions.has(path.extname(filePath).toLowerCase())
);

const auditTexts = auditTextFiles.map((filePath) => ({
  filePath: path.normalize(filePath),
  source: fs.readFileSync(filePath, 'utf8'),
}));

const assetsRoot = path.join(root, 'src', 'assets');
const staticAssets = walk(assetsRoot).filter(
  (filePath) => path.basename(filePath) !== '.gitkeep'
);

function assetReferenceTokens(filePath) {
  const relative = path.relative(assetsRoot, filePath).replaceAll('\\', '/');
  const encodedRelative = relative
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  return [
    path.basename(filePath),
    relative,
    encodedRelative,
    `assets/${relative}`,
    `/assets/${relative}`,
    `assets/${encodedRelative}`,
    `/assets/${encodedRelative}`,
  ];
}

const unreferencedStaticAssets = staticAssets
  .filter((assetPath) => {
    const normalizedAsset = path.normalize(assetPath);
    const tokens = assetReferenceTokens(assetPath);
    return !auditTexts.some(
      ({ filePath, source }) =>
        filePath !== normalizedAsset && tokens.some((token) => source.includes(token))
    );
  })
  .map(posix)
  .sort();

const nonDocumentationAuditTexts = auditTexts.filter(
  ({ filePath }) => !posix(filePath).startsWith('docs/')
);

const staticAssetsReferencedOnlyByDocumentation = staticAssets
  .filter((assetPath) => {
    const normalizedAsset = path.normalize(assetPath);
    const tokens = assetReferenceTokens(assetPath);
    const referencedAnywhere = auditTexts.some(
      ({ filePath, source }) =>
        filePath !== normalizedAsset && tokens.some((token) => source.includes(token))
    );
    const referencedOutsideDocumentation = nonDocumentationAuditTexts.some(
      ({ filePath, source }) =>
        filePath !== normalizedAsset && tokens.some((token) => source.includes(token))
    );
    return referencedAnywhere && !referencedOutsideDocumentation;
  })
  .map(posix)
  .sort();

const declaredAssetReferences = new Map();
for (const { filePath, source } of auditTexts) {
  const relativeSource = posix(filePath);
  if (
    relativeSource === 'scripts/quality/check-production-orphans.mjs'
    || /\.(?:spec|test)\.[cm]?[jt]s$/i.test(relativeSource)
  ) {
    continue;
  }

  for (const match of source.matchAll(
    /(?:https?:\/\/[^"'\s()<>]+)?\/(assets\/[^"'\s()<>?#]+)/g
  )) {
    const reference = match[1].replaceAll('%20', ' ');
    if (
      reference.includes('${')
      || reference.includes('[')
      || reference.includes(']')
      || reference.includes('`')
    ) {
      continue;
    }

    const sources = declaredAssetReferences.get(reference) ?? new Set();
    sources.add(relativeSource);
    declaredAssetReferences.set(reference, sources);
  }
}

const missingStaticAssets = [...declaredAssetReferences.entries()]
  .filter(([reference]) => {
    if (reference.startsWith('assets/webfonts/')) return false;
    return !fs.existsSync(path.join(root, 'src', reference));
  })
  .map(
    ([reference, sources]) =>
      `${reference} <- ${[...sources].sort().join(', ')}`
  )
  .sort();

// -----------------------------------------------------------------------------
// DEPENDÊNCIAS DIRETAS: produção sem import/referência identificável
// -----------------------------------------------------------------------------

const rootPackage = readJson(path.join(root, 'package.json'));
const productionDependencies = Object.keys(rootPackage.dependencies ?? {});
const dependencyAuditTexts = auditTexts.filter(({ filePath }) => {
  const relative = posix(filePath);
  return relative !== 'package.json'
    && relative !== 'package-lock.json'
    && !relative.startsWith('docs/');
});

function dependencyReferenced(packageName) {
  const patterns = [
    `'${packageName}'`,
    `"${packageName}"`,
    `'${packageName}/`,
    `"${packageName}/`,
    `node_modules/${packageName}/`,
    `"${packageName}:`,
    `'${packageName}:`,
  ];

  return dependencyAuditTexts.some(({ source }) =>
    patterns.some((pattern) => source.includes(pattern))
  );
}

const rootLock = readJson(path.join(root, 'package-lock.json'));

function requiredPeerOfReferencedDependency(packageName) {
  return productionDependencies.some((directDependency) => {
    if (directDependency === packageName || !dependencyReferenced(directDependency)) {
      return false;
    }

    const entry = rootLock.packages?.[`node_modules/${directDependency}`];
    const peerRange = entry?.peerDependencies?.[packageName];
    if (!peerRange) return false;

    return entry?.peerDependenciesMeta?.[packageName]?.optional !== true;
  });
}

// Dependências carregadas por código empacotado de frameworks podem não
// aparecer como imports literais no código da aplicação. Mantemos exceções
// explícitas somente quando o build prova a necessidade em runtime.
const indirectRuntimeDependencies = new Set([
  '@angular/animations',
]);

const unreferencedProductionDependencies = productionDependencies
  .filter(
    (packageName) =>
      !dependencyReferenced(packageName)
      && !requiredPeerOfReferencedDependency(packageName)
      && !indirectRuntimeDependencies.has(packageName)
  )
  .sort();

const developmentDependencies = Object.keys(rootPackage.devDependencies ?? {});

function requiredPeerOfReferencedDirectDependency(packageName) {
  return [...productionDependencies, ...developmentDependencies].some(
    (directDependency) => {
      if (
        directDependency === packageName
        || !dependencyReferenced(directDependency)
      ) {
        return false;
      }

      const entry = rootLock.packages?.[`node_modules/${directDependency}`];
      const peerRange = entry?.peerDependencies?.[packageName];
      if (!peerRange) return false;

      return entry?.peerDependenciesMeta?.[packageName]?.optional !== true;
    }
  );
}

// Binários invocados pelos scripts do package.json não aparecem como imports.
// O mapa fica explícito para não transformar qualquer devDependency em exceção.
const developmentDependencyExecutables = new Map([
  ['@angular/cli', ['ng']],
  ['eslint', ['eslint']],
  ['firebase-tools', ['firebase']],
  ['typescript', ['tsc']],
]);

const packageScripts = Object.values(rootPackage.scripts ?? {}).join('\n');

function developmentDependencyExecutableReferenced(packageName) {
  return (developmentDependencyExecutables.get(packageName) ?? []).some(
    (executable) =>
      new RegExp(`(?:^|[;&|\\s])${executable}(?:\\s|$)`).test(packageScripts)
  );
}

const intentionalDevelopmentDependencies = new Set([
  // Ferramenta de IDE/workspace: usada pelo Angular Language Service, não pelo runtime.
  '@angular/language-service',
]);

function isTypeCompanionOfReferencedDependency(packageName) {
  if (!packageName.startsWith('@types/')) return false;
  const runtimeName = packageName.slice('@types/'.length);
  return [...productionDependencies, ...developmentDependencies].some(
    (directDependency) =>
      directDependency === runtimeName && dependencyReferenced(directDependency)
  );
}

const unreferencedDevelopmentDependencies = developmentDependencies
  .filter(
    (packageName) =>
      !dependencyReferenced(packageName)
      && !requiredPeerOfReferencedDirectDependency(packageName)
      && !developmentDependencyExecutableReferenced(packageName)
      && !intentionalDevelopmentDependencies.has(packageName)
      && !isTypeCompanionOfReferencedDependency(packageName)
  )
  .sort();

const functionsPackage = readJson(path.join(root, 'functions', 'package.json'));
const functionsDependencies = Object.keys(functionsPackage.dependencies ?? {});
const functionsAuditTexts = auditTexts.filter(({ filePath }) =>
  filePath.startsWith(functionsSourceRoot + path.sep)
);

function functionsDependencyReferenced(packageName) {
  const patterns = [
    `'${packageName}'`,
    `"${packageName}"`,
    `'${packageName}/`,
    `"${packageName}/`,
  ];

  return functionsAuditTexts.some(({ source }) =>
    patterns.some((pattern) => source.includes(pattern))
  );
}

const unreferencedFunctionsDependencies = functionsDependencies
  .filter((packageName) => !functionsDependencyReferenced(packageName))
  .sort();

const functionsDevelopmentDependencies = Object.keys(
  functionsPackage.devDependencies ?? {}
);
const functionsPackageScripts = Object.values(
  functionsPackage.scripts ?? {}
).join('\n');
const functionsDevelopmentDependencyExecutables = new Map([
  ['eslint', ['eslint']],
  ['typescript', ['tsc']],
]);

function functionsDevelopmentDependencyReferenced(packageName) {
  if (functionsDependencyReferenced(packageName)) return true;

  const executables =
    functionsDevelopmentDependencyExecutables.get(packageName) ?? [];
  if (
    executables.some((executable) =>
      new RegExp(`(?:^|[;&|\\s])${executable}(?:\\s|$)`).test(
        functionsPackageScripts
      )
    )
  ) {
    return true;
  }

  return dependencyAuditTexts.some(({ filePath, source }) => {
    const relative = posix(filePath);
    if (
      !relative.startsWith('functions/')
      && relative !== 'firebase.json'
      && !relative.startsWith('scripts/')
    ) {
      return false;
    }

    return [
      `'${packageName}'`,
      `"${packageName}"`,
      `'${packageName}/`,
      `"${packageName}/`,
    ].some((pattern) => source.includes(pattern));
  });
}

const unreferencedFunctionsDevelopmentDependencies =
  functionsDevelopmentDependencies
    .filter(
      (packageName) => !functionsDevelopmentDependencyReferenced(packageName)
    )
    .sort();

// -----------------------------------------------------------------------------
// RECURSOS FIRESTORE LEGADOS: referências produtivas à coleção raiz posts
// -----------------------------------------------------------------------------

const legacyRootPostsConsumers = auditTexts
  .filter(({ filePath, source }) => {
    const relative = posix(filePath);
    if (
      relative.startsWith('docs/')
      || relative === 'scripts/quality/check-production-orphans.mjs'
      || /\.(?:spec|test)\.[cm]?[jt]s$/i.test(relative)
    ) {
      return false;
    }

    return (
      /\.collection\(\s*['"]posts['"]\s*\)/.test(source)
      || /\bcollection\([^,\n]+,\s*['"]posts['"]\s*\)/.test(source)
      || /['"]posts\//.test(source)
      || /match\s+\/posts(?:\/|\{)/.test(source)
    );
  })
  .map(({ filePath }) => posix(filePath))
  .sort();

// -----------------------------------------------------------------------------
// FIRESTORE RULES: fragments que não entram no manifesto canônico
// -----------------------------------------------------------------------------

const rulesRoot = path.join(root, 'firestore-rules');
const ruleFragments = walk(rulesRoot)
  .filter(
    (filePath) =>
      filePath.endsWith('.rules')
      && path.dirname(filePath) === rulesRoot
  )
  .map((filePath) => path.basename(filePath))
  .sort();

const rulesManifestPath = path.join(
  rulesRoot,
  'tools-rules',
  'firestore-rules-parts.mjs'
);
const rulesManifestSource = fs.readFileSync(rulesManifestPath, 'utf8');
const ruleFragmentsOutsideManifest = ruleFragments
  .filter((fileName) => !rulesManifestSource.includes(`'${fileName}'`))
  .map((fileName) => `firestore-rules/${fileName}`);

// -----------------------------------------------------------------------------
// SCRIPTS: arquivos sem chamada/referência identificável
// -----------------------------------------------------------------------------

const scriptRoot = path.join(root, 'scripts');
const operationalScripts = walk(scriptRoot).filter((filePath) =>
  ['.cmd', '.js', '.mjs', '.ps1', '.sh', '.ts'].includes(
    path.extname(filePath).toLowerCase()
  )
);

// Ferramentas que são, por contrato, entrypoints manuais. Elas não precisam ser
// chamadas por package.json/workflows/outros scripts para serem consideradas
// vivas; manter a lista explícita impede que qualquer script novo seja
// silenciosamente tratado da mesma forma.
const intentionalStandaloneScripts = new Set([
  'scripts/dev/inspect-auth-profile-integrity-emulator.mjs',
  'scripts/dev/inspect-community-membership.cmd',
  'scripts/dev/migrate-community-comment-replies.mjs',
  'scripts/dev/repair-discovery-location-emulator.mjs',
  'scripts/dev/resume-home-session.cmd',
]);

const unreferencedScripts = operationalScripts
  .filter((scriptPath) => {
    const normalized = path.normalize(scriptPath);
    const relative = posix(scriptPath);
    if (intentionalStandaloneScripts.has(relative)) return false;
    const windowsRelative = relative.replaceAll('/', '\\');
    const basename = path.basename(scriptPath);
    return !auditTexts.some(
      ({ filePath, source }) =>
        filePath !== normalized
        && (
          source.includes(relative)
          || source.includes(windowsRelative)
          || source.includes(basename)
        )
    );
  })
  .map(posix)
  .sort();

const allowedEmptyFiles = new Set(['src/assets/.gitkeep']);
const emptyTrackedFiles = walkAuditText(root)
  .filter((filePath) => fs.statSync(filePath).size === 0)
  .map(posix)
  .filter((filePath) => !allowedEmptyFiles.has(filePath))
  .sort();

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
printGroup('Helpers/stubs de teste sem consumidor', testSupportOrphans);
printGroup('Functions fora do grafo exportável', functionOrphans);
printGroup('Assets estáticos sem referência textual', unreferencedStaticAssets);
printGroup('Assets referenciados somente por documentação (revisão humana)', staticAssetsReferencedOnlyByDocumentation);
printGroup('Referências a assets locais inexistentes', missingStaticAssets);
printGroup('Dependências de produção sem referência identificável', unreferencedProductionDependencies);
printGroup('DevDependencies sem referência identificável (revisão humana)', unreferencedDevelopmentDependencies);
printGroup('Dependências de Functions sem referência identificável', unreferencedFunctionsDependencies);
printGroup('DevDependencies de Functions sem referência identificável (revisão humana)', unreferencedFunctionsDevelopmentDependencies);
printGroup('Consumidores produtivos proibidos da coleção raiz posts', legacyRootPostsConsumers);
printGroup('Fragments de Firestore Rules fora do manifesto', ruleFragmentsOutsideManifest);
printGroup('Scripts sem referência identificável', unreferencedScripts);
printGroup('Arquivos vazios rastreados', emptyTrackedFiles);

if (
  strict
  && (
    meaningfulTsOrphans.length > 0
    || meaningfulAssetOrphans.length > 0
    || testSupportOrphans.length > 0
    || functionOrphans.length > 0
    || missingStaticAssets.length > 0
    || unreferencedProductionDependencies.length > 0
    || unreferencedFunctionsDependencies.length > 0
    || legacyRootPostsConsumers.length > 0
    || ruleFragmentsOutsideManifest.length > 0
    || unreferencedScripts.length > 0
    || emptyTrackedFiles.length > 0
  )
) {
  console.error(
    '[production-orphans] Falha: remova o artefato órfão ou torne sua entrada/necessidade explícita.'
  );
  process.exit(1);
}

console.log(
  '[production-orphans] Auditoria global concluída; candidatos de assets/dependências exigem revisão humana antes de remoção.'
);
