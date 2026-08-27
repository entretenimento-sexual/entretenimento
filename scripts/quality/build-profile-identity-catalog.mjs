#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

const ROOT = process.cwd();
const SOURCE_PATH = resolve(ROOT, 'config/profile-identity-catalog.json');
const TARGETS = [
  resolve(ROOT, 'src/app/core/domain/profile-identity/profile-identity.catalog.ts'),
  resolve(ROOT, 'functions/src/identity/profile-identity.catalog.ts'),
];
const CHECK_ONLY = process.argv.includes('--check');
const ALLOWED_DISCOVERY_GROUPS = new Set([
  'man',
  'woman',
  'couple',
  'trans_woman',
  'trans_man',
  'travesti',
  'transgender',
  'crossdresser',
  'nonbinary',
]);

function assert(condition, message) {
  if (!condition) throw new Error(`[profile-identity-catalog] ${message}`);
}

function validateCatalog(catalog) {
  assert(Number.isInteger(catalog?.version) && catalog.version >= 1, 'version deve ser inteiro >= 1.');
  assert(Array.isArray(catalog?.options) && catalog.options.length > 0, 'options deve ser uma lista não vazia.');

  const codes = new Set();
  const sortOrders = new Set();
  for (const option of catalog.options) {
    assert(option && typeof option === 'object', 'cada opção deve ser um objeto.');
    assert(
      typeof option.code === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(option.code),
      `code inválido: ${String(option.code)}`
    );
    assert(!codes.has(option.code), `code duplicado: ${option.code}`);
    codes.add(option.code);
    assert(typeof option.label === 'string' && option.label.trim().length > 0 && option.label.length <= 80, `label inválido em ${option.code}`);
    assert(typeof option.shortLabel === 'string' && option.shortLabel.trim().length > 0 && option.shortLabel.length <= 80, `shortLabel inválido em ${option.code}`);
    assert(ALLOWED_DISCOVERY_GROUPS.has(option.discoveryGroup), `discoveryGroup inválido em ${option.code}`);
    assert(typeof option.couple === 'boolean', `couple inválido em ${option.code}`);
    assert(typeof option.enabled === 'boolean', `enabled inválido em ${option.code}`);
    assert(typeof option.selectable === 'boolean', `selectable inválido em ${option.code}`);
    assert(Number.isInteger(option.sortOrder) && option.sortOrder >= 0, `sortOrder inválido em ${option.code}`);
    assert(!sortOrders.has(option.sortOrder), `sortOrder duplicado: ${option.sortOrder}`);
    sortOrders.add(option.sortOrder);
  }
}

function renderCatalog(catalog) {
  const optionsLiteral = JSON.stringify(catalog.options, null, 2)
    .replace(/^/gm, '  ')
    .trimStart();

  return `// -----------------------------------------------------------------------------\n// GENERATED PROFILE IDENTITY CATALOG\n// -----------------------------------------------------------------------------\n// GERADO de config/profile-identity-catalog.json. Não edite este arquivo à mão.\n// Execute: node scripts/quality/build-profile-identity-catalog.mjs\n// -----------------------------------------------------------------------------\n\nexport type ProfileIdentityDiscoveryGroup =\n  | 'man'\n  | 'woman'\n  | 'couple'\n  | 'trans_woman'\n  | 'trans_man'\n  | 'travesti'\n  | 'transgender'\n  | 'crossdresser'\n  | 'nonbinary';\n\nexport interface ProfileIdentityOption {\n  readonly code: string;\n  readonly label: string;\n  readonly shortLabel: string;\n  readonly discoveryGroup: ProfileIdentityDiscoveryGroup;\n  readonly couple: boolean;\n  readonly enabled: boolean;\n  readonly selectable: boolean;\n  readonly sortOrder: number;\n}\n\nexport interface ProfileIdentityCatalog {\n  readonly version: number;\n  readonly options: readonly ProfileIdentityOption[];\n}\n\nexport const PROFILE_IDENTITY_CATALOG_VERSION = ${catalog.version};\n\nexport const PROFILE_IDENTITY_OPTIONS: readonly ProfileIdentityOption[] = Object.freeze(\n${optionsLiteral}\n);\n\nexport const PROFILE_IDENTITY_CATALOG: ProfileIdentityCatalog = Object.freeze({\n  version: PROFILE_IDENTITY_CATALOG_VERSION,\n  options: PROFILE_IDENTITY_OPTIONS,\n});\n\nconst PROFILE_IDENTITY_BY_CODE = new Map(\n  PROFILE_IDENTITY_OPTIONS.map((option) => [option.code, option] as const)\n);\n\nexport const SELECTABLE_PROFILE_IDENTITY_OPTIONS = Object.freeze(\n  PROFILE_IDENTITY_OPTIONS\n    .filter((option) => option.enabled && option.selectable)\n    .slice()\n    .sort((first, second) => first.sortOrder - second.sortOrder)\n);\n\nexport function resolveProfileIdentityOption(\n  code: unknown\n): ProfileIdentityOption | null {\n  const normalized = String(code ?? '').trim().toLowerCase();\n  return PROFILE_IDENTITY_BY_CODE.get(normalized) ?? null;\n}\n\nexport function resolveProfileIdentityDiscoveryGroup(\n  code: unknown\n): ProfileIdentityDiscoveryGroup | null {\n  return resolveProfileIdentityOption(code)?.discoveryGroup ?? null;\n}\n\nexport function isSelectableProfileIdentityCode(code: unknown): boolean {\n  const option = resolveProfileIdentityOption(code);\n  return option?.enabled === true && option.selectable === true;\n}\n\nexport function isCoupleProfileIdentityCode(code: unknown): boolean {\n  return resolveProfileIdentityOption(code)?.couple === true;\n}\n`;
}

async function main() {
  const source = JSON.parse(await readFile(SOURCE_PATH, 'utf8'));
  validateCatalog(source);
  const expected = renderCatalog(source);

  if (CHECK_ONLY) {
    const stale = [];
    for (const target of TARGETS) {
      const current = await readFile(target, 'utf8').catch(() => '');
      if (current.replace(/\r\n/g, '\n') !== expected) stale.push(target);
    }

    if (stale.length > 0) {
      console.error('[profile-identity-catalog] Arquivos gerados estão desatualizados:');
      stale.forEach((target) => console.error(`- ${target}`));
      console.error('Execute: npm run identity:catalog:build');
      process.exit(1);
    }

    console.log('[profile-identity-catalog] Catálogo canônico e runtimes sincronizados.');
    return;
  }

  await Promise.all(TARGETS.map((target) => writeFile(target, expected, 'utf8')));
  console.log('[profile-identity-catalog] Catálogo gerado para Angular e Functions.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
