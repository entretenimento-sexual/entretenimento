// scripts/dev/start-emulator-with-data.mjs
// -----------------------------------------------------------------------------
// SAFE EMULATOR START
// -----------------------------------------------------------------------------
// Inicia o Firebase Emulator Suite preservando dados locais.
//
// Decisões de segurança operacional:
// - gera firestore.rules a partir dos fragments antes de iniciar Firebase;
// - NÃO mata portas automaticamente;
// - detecta portas ocupadas antes de criar backup ou iniciar Firebase;
// - cria backup automático de .emulator-data antes de iniciar;
// - valida firebase-export-metadata.json antes de repassá-lo ao Firebase CLI;
// - usa --export-on-exit para salvar estado ao sair com Ctrl+C;
// - usa --import somente quando .emulator-data já tem export válido;
// - evita sobrescrever um export antigo sem snapshot prévio;
// - permite escolher o conjunto de emuladores via FIREBASE_EMULATORS_ONLY.
//
// Variáveis:
// - FIREBASE_EMULATORS_ONLY=auth,firestore,functions
// - FIREBASE_PROJECT_ID=entretenimento-sexual
// - FIREBASE_STORAGE_BUCKET=entretenimento-sexual.appspot.com
// - FIREBASE_EMULATOR_DATA_DIR=.emulator-data
// - FIREBASE_EMULATOR_BACKUP_DIR=.emulator-data-backups
// - FIREBASE_EMULATOR_SKIP_BACKUP=1 para pular backup manualmente
// - FIREBASE_EMULATOR_SKIP_PORT_CHECK=1 para pular checagem de portas
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { validateEmulatorSnapshotImport } from './emulator-snapshot-preflight.mjs';
import { assertEmulatorCredentialsIsolated, isolateWindowsFirebaseCliEnvironment } from './emulator-credential-preflight.mjs';

const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const storageBucket =
  process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`;
const only = process.env.FIREBASE_EMULATORS_ONLY || 'auth,firestore,functions';
const dataDir = process.env.FIREBASE_EMULATOR_DATA_DIR || '.emulator-data';
const backupRootDir = process.env.FIREBASE_EMULATOR_BACKUP_DIR || '.emulator-data-backups';
const skipBackup = process.env.FIREBASE_EMULATOR_SKIP_BACKUP === '1';
const skipPortCheck = process.env.FIREBASE_EMULATOR_SKIP_PORT_CHECK === '1';
const root = process.cwd();
const dataPath = path.resolve(root, dataDir);
const backupRootPath = path.resolve(root, backupRootDir);
const rulesBuildScript = path.resolve(
  root,
  'firestore-rules',
  'tools-rules',
  'build-firestore-rules.mjs'
);

const COMMON_PORTS = [
  { label: 'Emulator Hub', port: 4400 },
  { label: 'Emulator UI', port: 4000 },
  { label: 'Logging', port: 4500 },
];

const EMULATOR_PORTS = {
  auth: [{ label: 'Authentication', port: 9099 }],
  firestore: [{ label: 'Firestore', port: 8080 }],
  functions: [{ label: 'Functions', port: 5001 }],
  storage: [{ label: 'Storage', port: 9199 }],
  database: [{ label: 'Realtime Database', port: 9000 }],
  pubsub: [{ label: 'Pub/Sub', port: 8087 }],
  ui: [],
};

function timestampForPath() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
}

function copyDirectory(source, target) {
  fs.cpSync(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
}

function quoteWindowsArg(value) {
  const normalized = String(value ?? '');

  if (/^[A-Za-z0-9_/:=.,@+\-]+$/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, '\\"')}"`;
}

function parseRequestedEmulators(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniquePorts(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = `${item.label}:${item.port}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildFirestoreRules() {
  if (!fs.existsSync(rulesBuildScript)) {
    console.error(`[emu:safe] Gerador de Rules não encontrado: ${rulesBuildScript}`);
    process.exit(1);
  }

  console.log('[emu:safe] Gerando firestore.rules a partir de firestore-rules/*...');
  const result = spawnSync(process.execPath, [rulesBuildScript], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  if (result.error) {
    console.error('[emu:safe] Falha ao executar o gerador de Rules:', result.error);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`[emu:safe] Gerador de Rules terminou com código ${result.status}.`);
    process.exit(result.status ?? 1);
  }
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, '127.0.0.1');
  });
}

async function assertPortsAvailable() {
  if (skipPortCheck) {
    console.warn('[emu:safe] Checagem de portas ignorada por FIREBASE_EMULATOR_SKIP_PORT_CHECK=1.');
    return;
  }

  const requested = parseRequestedEmulators(only);
  const requestedPorts = requested.flatMap((emulator) => EMULATOR_PORTS[emulator] ?? []);
  const portsToCheck = uniquePorts([...COMMON_PORTS, ...requestedPorts]);
  const busyPorts = [];

  for (const portInfo of portsToCheck) {
    const available = await canListenOnPort(portInfo.port);

    if (!available) {
      busyPorts.push(portInfo);
    }
  }

  if (!busyPorts.length) {
    return;
  }

  console.error('[emu:safe] Abortado: há portas de emulator ocupadas.');
  console.error('[emu:safe] Portas ocupadas:');

  for (const item of busyPorts) {
    console.error(`  - ${item.label}: ${item.port}`);
  }

  console.error('[emu:safe] Identifique os processos: npm run emu:diagnose. Se apenas o Firestore estiver orfao: npm run emu:orphan:diagnose.');
  console.error('[emu:safe] Use npm run emu:pre apenas se tiver certeza de que pode matar esses processos.');
  process.exit(1);
}

function backupExistingData() {
  if (skipBackup) {
    console.warn('[emu:safe] Backup automático ignorado por FIREBASE_EMULATOR_SKIP_BACKUP=1.');
    return null;
  }

  if (!fs.existsSync(dataPath)) {
    console.warn(`[emu:safe] ${dataDir} não existe. Nada para copiar antes do start.`);
    return null;
  }

  fs.mkdirSync(backupRootPath, { recursive: true });

  const backupPath = path.join(
    backupRootPath,
    `${path.basename(dataDir)}-${timestampForPath()}`
  );

  copyDirectory(dataPath, backupPath);
  console.log(`[emu:safe] Backup criado em ${path.relative(root, backupPath)}`);
  return backupPath;
}

function validateImportMetadata(backupPath) {
  try {
    const hasImport = validateEmulatorSnapshotImport(
      dataPath,
      parseRequestedEmulators(only)
    );
    if (hasImport) {
      console.log('[emu:safe] Manifesto e exports de Auth/Firestore/Storage verificados.');
    }
    return hasImport;
  } catch (error) {
    console.error('[emu:safe] Snapshot inválido: importação abortada antes de iniciar Firebase.');
    console.error('[emu:safe] ' + (error instanceof Error ? error.message : String(error)));
    if (backupPath) {
      console.error('[emu:safe] Snapshot anterior preservado em ' + path.relative(root, backupPath));
    }
    console.error('[emu:safe] Corrija o snapshot ou use uma pasta de dados vazia e distinta explicitamente.');
    process.exit(1);
  }
}

function spawnFirebaseEmulator(args, env) {
  if (process.platform !== 'win32') {
    return spawn('npx', args, {
      stdio: 'inherit',
      env,
      shell: false,
    });
  }

  const commandLine = ['npx', ...args]
    .map((arg) => quoteWindowsArg(arg))
    .join(' ');

  return spawn('cmd.exe', ['/d', '/s', '/c', commandLine], {
    stdio: 'inherit',
    env,
    shell: false,
  });
}

// google-auth-library and firebase-tools configstore read APPDATA on Windows.
// Use an empty child-only APPDATA; never edit the user's real credential files.
let temporaryFirebaseAppData = null;
let firebaseCredentialEnv = process.env;
try {
  if (process.platform === 'win32') {
    temporaryFirebaseAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'entretenimento-firebase-cli-'));
    firebaseCredentialEnv = isolateWindowsFirebaseCliEnvironment(process.env, temporaryFirebaseAppData);
  }
  assertEmulatorCredentialsIsolated({ env: firebaseCredentialEnv, platform: process.platform });
  console.log(process.platform === 'win32'
    ? '[emu:safe] Firebase CLI: APPDATA/cache de login isolados no subprocesso; preflight OK.'
    : '[emu:safe] Firebase CLI: preflight de credenciais conhecidas OK.');
} catch (error) {
  console.error('[emu:safe] Segurança: ' + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

process.once('exit', () => {
  if (temporaryFirebaseAppData) {
    try { fs.rmSync(temporaryFirebaseAppData, { recursive: true, force: true }); }
    catch { console.warn('[emu:safe] Não foi possível limpar APPDATA temporário do emulador.'); }
  }
});

buildFirestoreRules();
await assertPortsAvailable();
const backupPath = backupExistingData();
const hasValidImportMetadata = validateImportMetadata(backupPath);

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

if (hasValidImportMetadata) {
  args.push('--import', dataDir);
  console.log(`[emu:safe] Importando dados de ${dataDir}`);
} else {
  console.warn(
    `[emu:safe] ${dataDir} sem firebase-export-metadata.json. ` +
      'Subindo sem import e exportando ao sair.'
  );
}

const env = {
  ...firebaseCredentialEnv,
  FIREBASE_PROJECT_ID: projectId,
  FIREBASE_STORAGE_BUCKET: storageBucket,
};

if (process.platform === 'win32') {
  const javaHome = String(env.JAVA_HOME ?? '').trim();
  const javaExe = javaHome
    ? path.join(javaHome, 'bin', 'java.exe')
    : '';

  if (javaHome && !fs.existsSync(javaExe)) {
    console.warn(
      `[emu:safe] JAVA_HOME inválido ignorado: ${javaHome}. ` +
        'O Firebase Emulator usará o Java disponível no PATH.'
    );
    delete env.JAVA_HOME;
  }
}

console.log(`[emu:safe] Projeto=${projectId}`);
console.log(`[emu:safe] StorageBucket=${storageBucket}`);
console.log(`[emu:safe] Emuladores=${only}`);
console.log(`[emu:safe] Export-on-exit=${dataDir}`);
console.log('[emu:safe] Para resetar portas, rode manualmente: npm run emu:pre');

const child = spawnFirebaseEmulator(args, env);

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
