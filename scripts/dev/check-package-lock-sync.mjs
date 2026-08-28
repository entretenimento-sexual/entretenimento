import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const packagePairs = [
  {
    label: 'aplicacao',
    manifestPath: path.join(projectRoot, 'package.json'),
    lockPath: path.join(projectRoot, 'package-lock.json'),
  },
  {
    label: 'Functions',
    manifestPath: path.join(projectRoot, 'functions', 'package.json'),
    lockPath: path.join(projectRoot, 'functions', 'package-lock.json'),
  },
];

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.error(`[deps:lock] Nao foi possivel ler ${filePath}.`);
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return null;
  }
}

function compareDependencyGroup(label, group, manifest, lockRoot) {
  const manifestDependencies = manifest[group] ?? {};
  const lockDependencies = lockRoot[group] ?? {};
  const names = new Set([
    ...Object.keys(manifestDependencies),
    ...Object.keys(lockDependencies),
  ]);
  const mismatches = [];

  for (const name of [...names].sort()) {
    const manifestVersion = manifestDependencies[name] ?? null;
    const lockVersion = lockDependencies[name] ?? null;

    if (manifestVersion !== lockVersion) {
      mismatches.push({ name, manifestVersion, lockVersion });
    }
  }

  if (mismatches.length === 0) {
    return true;
  }

  console.error(`[deps:lock] Divergencias em ${label} (${group}):`);

  for (const mismatch of mismatches) {
    console.error(
      `  ${mismatch.name}: package.json=${mismatch.manifestVersion ?? '<ausente>'} ` +
      `package-lock.json=${mismatch.lockVersion ?? '<ausente>'}`
    );
  }

  return false;
}

let valid = true;

for (const pair of packagePairs) {
  const manifest = readJson(pair.manifestPath);
  const lock = readJson(pair.lockPath);

  if (!manifest || !lock) {
    valid = false;
    continue;
  }

  const lockRoot = lock.packages?.[''];

  if (!lockRoot) {
    console.error(
      `[deps:lock] package-lock.json de ${pair.label} nao possui packages[""].`
    );
    valid = false;
    continue;
  }

  valid = compareDependencyGroup(
    pair.label,
    'dependencies',
    manifest,
    lockRoot
  ) && valid;
  valid = compareDependencyGroup(
    pair.label,
    'devDependencies',
    manifest,
    lockRoot
  ) && valid;
}

if (!valid) {
  console.error(
    '[deps:lock] Corrija o manifesto ou regenere o lock antes de executar npm ci.'
  );
  process.exitCode = 1;
} else {
  console.log('[deps:lock] Manifestos e arquivos de lock estao alinhados.');
}
