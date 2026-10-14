// Run pure Functions tests without inheriting a developer's running emulator.
// Firestore-backed chat integration tests belong to the isolated
// scripts/quality/run-chat-reconciliation-emulator.mjs runner.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const functionsDir = join(repoRoot, 'functions');
const compiledDir = join(functionsDir, 'lib');

function listCompiledUnitTests(directory, result = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const location = join(directory, entry.name);
    if (entry.isDirectory()) {
      listCompiledUnitTests(location, result);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.test.js') &&
      !/\.emulator(?:-cli)?\.test\.js$/.test(entry.name)
    ) {
      result.push(relative(functionsDir, location).split(sep).join('/'));
    }
  }
  return result;
}

const files = listCompiledUnitTests(compiledDir).sort();
if (files.length === 0) {
  console.error('[functions:test] Nenhum teste compilado encontrado.');
  process.exit(2);
}

if (files.some(file => /\.emulator(?:-cli)?\.test\.js$/.test(file))) {
  console.error('[functions:test] Teste com emulador entrou na suíte unitária.');
  process.exit(2);
}

const env = { ...process.env };
// An inherited local host must never activate Firestore-mutating tests.
// Remove real-project identity/credentials; tests use a disposable demo ID.
for (const key of [
  'FIRESTORE_EMULATOR_HOST',
  'FIREBASE_AUTH_EMULATOR_HOST',
  'FIREBASE_STORAGE_EMULATOR_HOST',
  'CLOUD_TASKS_EMULATOR_HOST',
  'FUNCTIONS_EMULATOR',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'CHAT_RECONCILIATION_EXPECTED_EMULATOR_HOST',
]) {
  delete env[key];
}
const projectId = 'demo-entretenimento-functions-unit-tests';
env.GCLOUD_PROJECT = projectId;
env.GOOGLE_CLOUD_PROJECT = projectId;
env.GCP_PROJECT = projectId;
env.FIREBASE_CONFIG = JSON.stringify({
  projectId,
  storageBucket: projectId + '.appspot.com',
});

console.log('[functions:test] ' + files.length +
  ' testes isolados; integrações do Firestore usam executor próprio.');
const outcome = spawnSync(process.execPath, ['--test', ...files], {
  cwd: functionsDir,
  env,
  stdio: 'inherit',
  windowsHide: true,
  shell: false,
});
if (outcome.error) {
  console.error('[functions:test] Falha ao executar a suíte:', outcome.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = outcome.status ?? 1;
}
