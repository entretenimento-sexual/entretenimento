// scripts/quality/run-storage-rules-tests.mjs
// -----------------------------------------------------------------------------
// Executa a suíte de Cloud Storage Rules contra um emulador isolado.
//
// Compatibilidade:
// - executa as entradas JavaScript locais do firebase-tools e do Vitest;
// - não depende de firebase.cmd, vitest.cmd ou resolução de node_modules/.bin;
// - não usa shell no processo principal, evitando injeção de argumentos.
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
const vitestCliEntry = resolve(
  process.cwd(),
  'node_modules',
  'vitest',
  'vitest.mjs'
);
const testCommand = [
  'node',
  'node_modules/vitest/vitest.mjs',
  'run',
  '--config',
  'vitest.storage-rules.config.ts',
  '--reporter=verbose',
].join(' ');

const args = [
  firebaseCliEntry,
  'emulators:exec',
  '--config',
  'firebase.storage-rules-test.json',
  '--only',
  'storage',
  '--project',
  'demo-entretenimento-storage-rules',
  testCommand,
];

for (const [label, entry] of [
  ['Firebase CLI', firebaseCliEntry],
  ['Vitest CLI', vitestCliEntry],
]) {
  if (!existsSync(entry)) {
    console.error(
      `[storage-rules] ${label} não encontrado em: ${entry}. Execute npm install antes dos testes.`
    );
    process.exit(1);
  }
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
