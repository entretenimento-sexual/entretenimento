// scripts/quality/audit-angular-component-consumers.mjs
// -----------------------------------------------------------------------------
// ANGULAR COMPONENT CONSUMER AUDIT
// -----------------------------------------------------------------------------
// Evita classificar componente como "vivo" apenas porque aparece em declarations/
// exports de um NgModule. Para candidatos legados, cruza:
// - seletor usado em templates produtivos;
// - símbolo importado/referenciado em TypeScript produtivo;
// - rotas/lazy imports;
// - referências somente estruturais (NgModule) e somente de teste.
//
// Uso:
//   node scripts/quality/audit-angular-component-consumers.mjs
//   node scripts/quality/audit-angular-component-consumers.mjs --strict
//
// Em --strict, um alvo sem consumidor funcional produtivo falha.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const strict = process.argv.includes('--strict');

const targets = [
  {
    name: 'UserPhotoManagerComponent',
    selector: 'app-user-photo-manager',
    source: 'src/app/user-profile/user-photo-manager/user-photo-manager.component.ts',
    structuralOnly: [],
  },
  {
    name: 'UploadPhotoComponent',
    selector: 'app-upload-photo',
    source: 'src/app/shared/components-globais/upload-photo/upload-photo.component.ts',
    structuralOnly: [
      'src/app/shared/shared.module.ts',
    ],
  },
];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, '/');
}

const appRoot = path.join(root, 'src', 'app');
const allAppFiles = walk(appRoot)
  .filter((file) => /\.(?:ts|html)$/.test(file))
  .map((file) => ({
    absolute: file,
    relative: relative(file),
    source: fs.readFileSync(file, 'utf8'),
  }));

function isTestFile(relativePath) {
  return /\.(?:spec|test)\.ts$/.test(relativePath)
    || relativePath.includes('/__tests__/')
    || relativePath.includes('/testing/');
}

function classifyTarget(target) {
  const productive = allAppFiles.filter(({ relative }) => !isTestFile(relative));
  const tests = allAppFiles.filter(({ relative }) => isTestFile(relative));

  const selectorConsumers = productive
    .filter(({ relative, source }) =>
      relative.endsWith('.html')
      && relative !== target.source.replace(/\.ts$/, '.html')
      && source.includes(target.selector)
    )
    .map(({ relative }) => relative);

  const symbolConsumers = productive
    .filter(({ relative, source }) =>
      relative.endsWith('.ts')
      && relative !== target.source
      && !target.structuralOnly.includes(relative)
      && source.includes(target.name)
    )
    .map(({ relative }) => relative);

  const routeConsumers = productive
    .filter(({ relative, source }) =>
      relative.endsWith('.ts')
      && relative !== target.source
      && (
        source.includes(`.then((m) => m.${target.name})`)
        || source.includes(`.then(m => m.${target.name})`)
        || source.includes(`component: ${target.name}`)
        || source.includes(target.source.replace(/^src\/app\//, './').replace(/\.ts$/, ''))
      )
    )
    .map(({ relative }) => relative)
    .filter((relative) => !target.structuralOnly.includes(relative));

  const structuralReferences = productive
    .filter(({ relative, source }) =>
      target.structuralOnly.includes(relative)
      && source.includes(target.name)
    )
    .map(({ relative }) => relative);

  const testReferences = tests
    .filter(({ source }) =>
      source.includes(target.name) || source.includes(target.selector)
    )
    .map(({ relative }) => relative);

  const functionalConsumers = [
    ...new Set([
      ...selectorConsumers,
      ...symbolConsumers,
      ...routeConsumers,
    ]),
  ].sort();

  return {
    ...target,
    selectorConsumers: [...new Set(selectorConsumers)].sort(),
    symbolConsumers: [...new Set(symbolConsumers)].sort(),
    routeConsumers: [...new Set(routeConsumers)].sort(),
    structuralReferences: [...new Set(structuralReferences)].sort(),
    testReferences: [...new Set(testReferences)].sort(),
    functionalConsumers,
    status: functionalConsumers.length > 0
      ? 'ACTIVE'
      : structuralReferences.length > 0
        ? 'DECLARATION_ONLY'
        : testReferences.length > 0
          ? 'TEST_ONLY'
          : 'ORPHAN_CANDIDATE',
  };
}

const results = targets.map(classifyTarget);

for (const result of results) {
  console.log(
    `[angular-component-consumers] ${result.name}: ${result.status}; ` +
    `consumidores funcionais=${result.functionalConsumers.length}; ` +
    `referências estruturais=${result.structuralReferences.length}; ` +
    `referências de teste=${result.testReferences.length}.`
  );

  for (const consumer of result.functionalConsumers) {
    console.log(`  - funcional: ${consumer}`);
  }
  for (const structural of result.structuralReferences) {
    console.log(`  - estrutural: ${structural}`);
  }
  for (const test of result.testReferences) {
    console.log(`  - teste: ${test}`);
  }
}

const withoutFunctionalConsumer = results.filter(
  (result) => result.functionalConsumers.length === 0
);

if (strict && withoutFunctionalConsumer.length > 0) {
  console.error(
    '[angular-component-consumers] Falha strict: há componente sem consumidor funcional produtivo.'
  );
  for (const result of withoutFunctionalConsumer) {
    console.error(`- ${result.name}: ${result.status}`);
  }
  process.exit(1);
}

console.log(
  '[angular-component-consumers] Auditoria concluída. Remoção exige convergência entre consumidor funcional, rotas/imports e dead-code; declaração de NgModule isolada não conta como uso real.'
);
