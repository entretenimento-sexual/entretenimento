// scripts/quality/run-storage-rules-tests.mjs
// -----------------------------------------------------------------------------
// Executa a suíte de Cloud Storage Rules contra um emulador isolado.
//
// Compatibilidade:
// - executa a entrada JavaScript do firebase-tools pelo próprio Node;
// - não depende de firebase.cmd no Windows;
// - não usa shell, evitando problemas de escaping e injeção de argumentos.
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const firebaseCliEntry = resolve(
  process.cwd(),
  'node_modules',
  'firebase-tools',
  'lib',
  'bin',
  'firebase.js'
);

const args = [
  firebaseCliEntry,
  'emulators:exec',
  '--config',
  'firebase.storage-rules-test.json',
  '--only',
  'storage',
  '--project',
  'demo-entretenimento-storage-rules',
  'vitest run --config vitest.storage-rules.config.ts --reporter=verbose',
];

if (!existsSync(firebaseCliEntry)) {
  console.error(
    `[storage-rules] Firebase CLI não encontrado em: ${firebaseCliEntry}. Execute npm install antes dos testes.`
  );
  process.exit(1);
}

const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: 'inherit',
});

let launchFailed = false;

child.on('error', (error) => {
  launchFailed = true;
  console.error(
    '[storage-rules] Não foi possível iniciar o emulador:',
    error
  );
  process.exitCode = 1;
});

child.on('close', (code) => {
  if (launchFailed) {
    process.exitCode = 1;
    return;
  }

  process.exitCode = code === 0 ? 0 : code ?? 1;
});
