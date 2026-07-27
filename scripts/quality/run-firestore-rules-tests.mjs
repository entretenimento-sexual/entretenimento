// scripts/quality/run-firestore-rules-tests.mjs
// -----------------------------------------------------------------------------
// Executa a suíte de Firestore Rules preservando a saída em tempo real e falha
// também quando o emulador atinge limites internos de avaliação. Sem esta
// proteção, um assertFails pode passar por causa de complexidade excessiva, e
// não porque a regra negou a operação pelo motivo esperado.
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
  'firebase.rules-test.json',
  '--only',
  'firestore',
  '--project',
  'demo-entretenimento-rules',
  'vitest run --config vitest.rules.config.ts --reporter=verbose',
];

const forbiddenDiagnostics = [
  'maximum of 1000 expressions to evaluate has been reached',
  'maximum of 10 document access calls',
  'maximum of 20 document access calls',
];

if (!existsSync(firebaseCliEntry)) {
  console.error(
    `[rules] Firebase CLI não encontrado em: ${firebaseCliEntry}. Execute npm install antes dos testes.`
  );
  process.exit(1);
}

const child = spawn(process.execPath, args, {
  cwd: process.cwd(),
  env: process.env,
  shell: false,
  stdio: ['inherit', 'pipe', 'pipe'],
});

let combinedOutput = '';
let launchFailed = false;

child.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  combinedOutput += text;
  process.stdout.write(text);
});

child.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  combinedOutput += text;
  process.stderr.write(text);
});

child.on('error', (error) => {
  launchFailed = true;
  console.error('[rules] Não foi possível iniciar o emulador:', error);
  process.exitCode = 1;
});

child.on('close', (code) => {
  if (launchFailed) {
    process.exitCode = 1;
    return;
  }

  const normalizedOutput = combinedOutput.toLowerCase();
  const detected = forbiddenDiagnostics.filter((diagnostic) =>
    normalizedOutput.includes(diagnostic.toLowerCase())
  );

  if (detected.length > 0) {
    console.error('\n[rules] Falha por complexidade interna das Firestore Rules:');
    for (const diagnostic of detected) {
      console.error(`- ${diagnostic}`);
    }
    console.error(
      '[rules] A negação deve ocorrer pela política declarada, não por limite do avaliador.'
    );
    process.exitCode = 1;
    return;
  }

  process.exitCode = code === 0 ? 0 : code ?? 1;
});
