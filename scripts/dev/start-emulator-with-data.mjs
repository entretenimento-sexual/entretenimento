// scripts/dev/start-emulator-with-data.mjs
// -----------------------------------------------------------------------------
// SAFE EMULATOR START
// -----------------------------------------------------------------------------
// Inicia o Firebase Emulator Suite preservando dados locais.
//
// Decisões de segurança operacional:
// - NÃO mata portas automaticamente;
// - cria backup automático de .emulator-data antes de iniciar;
// - usa --export-on-exit para salvar estado ao sair com Ctrl+C;
// - usa --import somente quando .emulator-data já tem export válido;
// - evita sobrescrever um export antigo sem snapshot prévio;
// - permite escolher o conjunto de emuladores via FIREBASE_EMULATORS_ONLY.
//
// Variáveis:
// - FIREBASE_EMULATORS_ONLY=auth,firestore,functions
// - FIREBASE_PROJECT_ID=entretenimento-sexual
// - FIREBASE_EMULATOR_DATA_DIR=.emulator-data
// - FIREBASE_EMULATOR_BACKUP_DIR=.emulator-data-backups
// - FIREBASE_EMULATOR_SKIP_BACKUP=1 para pular backup manualmente
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const only = process.env.FIREBASE_EMULATORS_ONLY || 'auth,firestore,functions';
const dataDir = process.env.FIREBASE_EMULATOR_DATA_DIR || '.emulator-data';
const backupRootDir = process.env.FIREBASE_EMULATOR_BACKUP_DIR || '.emulator-data-backups';
const skipBackup = process.env.FIREBASE_EMULATOR_SKIP_BACKUP === '1';
const root = process.cwd();
const dataPath = path.resolve(root, dataDir);
const metadataPath = path.join(dataPath, 'firebase-export-metadata.json');
const backupRootPath = path.resolve(root, backupRootDir);

function timestampForPath(): string {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
}

function copyDirectory(source: string, target: string): void {
  fs.cpSync(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}

function backupExistingData(): void {
  if (skipBackup) {
    console.warn('[emu:safe] Backup automático ignorado por FIREBASE_EMULATOR_SKIP_BACKUP=1.');
    return;
  }

  if (!fs.existsSync(dataPath)) {
    console.warn(`[emu:safe] ${dataDir} não existe. Nada para copiar antes do start.`);
    return;
  }

  fs.mkdirSync(backupRootPath, { recursive: true });

  const backupPath = path.join(
    backupRootPath,
    `${path.basename(dataDir)}-${timestampForPath()}`
  );

  copyDirectory(dataPath, backupPath);
  console.log(`[emu:safe] Backup criado em ${path.relative(root, backupPath)}`);
}

backupExistingData();

const args = [
  'firebase',
  'emulators:start',
  '--only',
  only,
  '--project',
  projectId,
  '--export-on-exit',
  dataDir,
];

if (fs.existsSync(metadataPath)) {
  args.push('--import', dataDir);
  console.log(`[emu:safe] Importando dados de ${dataDir}`);
} else {
  console.warn(
    `[emu:safe] ${dataDir} sem firebase-export-metadata.json. ` +
      'Subindo sem import e exportando ao sair.'
  );
}

const env = { ...process.env };

if (process.platform === 'win32') {
  const jdkPath = 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.10.7-hotspot';

  if (fs.existsSync(jdkPath)) {
    env.JAVA_HOME = jdkPath;
    env.PATH = `${path.join(jdkPath, 'bin')};${env.PATH ?? ''}`;
  }
}

console.log(`[emu:safe] Projeto=${projectId}`);
console.log(`[emu:safe] Emuladores=${only}`);
console.log(`[emu:safe] Export-on-exit=${dataDir}`);
console.log('[emu:safe] Para resetar portas, rode manualmente: npm run emu:pre');

const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(command, args, {
  stdio: 'inherit',
  env,
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`[emu:safe] Finalizado por sinal ${signal}.`);
    process.exit(0);
  }

  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('[emu:safe] Falha ao iniciar emuladores:', error);
  process.exit(1);
});
