// scripts/dev/save-emulator-data.mjs
// -----------------------------------------------------------------------------
// CHECKPOINT SEGURO DO FIREBASE EMULATOR
// -----------------------------------------------------------------------------
// Salva o estado corrente do Emulator Suite em .emulator-data sem depender
// apenas do --export-on-exit.
//
// Garantias:
// - só exporta quando o Emulator Hub está acessível;
// - cria backup do snapshot anterior antes de sobrescrevê-lo;
// - usa o mesmo projectId do ambiente local;
// - falha fechado: quem chamou decide não encerrar os emuladores se o export
//   não puder ser concluído;
// - valida a presença de firebase-export-metadata.json após a exportação.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const projectId = process.env.FIREBASE_PROJECT_ID || 'entretenimento-sexual';
const dataDir = process.env.FIREBASE_EMULATOR_DATA_DIR || '.emulator-data';
const backupRootDir =
  process.env.FIREBASE_EMULATOR_BACKUP_DIR || '.emulator-data-backups';
const hubPort = Number(process.env.FIREBASE_EMULATOR_HUB_PORT || 4400);
const requireRunning = process.argv.includes('--require-running');

const dataPath = path.resolve(root, dataDir);
const backupRootPath = path.resolve(root, backupRootDir);
const metadataPath = path.join(dataPath, 'firebase-export-metadata.json');

function timestampForPath() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .replace('Z', '');
}

function quoteWindowsArg(value) {
  const normalized = String(value ?? '');

  if (/^[A-Za-z0-9_/:=.,@+\-]+$/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, '\\"')}"`;
}

function copyExistingSnapshot() {
  if (!fs.existsSync(dataPath)) {
    return null;
  }

  fs.mkdirSync(backupRootPath, { recursive: true });

  const backupPath = path.join(
    backupRootPath,
    `${path.basename(dataDir)}-checkpoint-${timestampForPath()}`
  );

  fs.cpSync(dataPath, backupPath, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });

  return backupPath;
}

function canConnectToPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };

    socket.setTimeout(750);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function runFirebaseExport() {
  const args = [
    'firebase',
    'emulators:export',
    dataDir,
    '--force',
    '--project',
    projectId,
  ];

  if (process.platform !== 'win32') {
    return spawnSync('npx', args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
  }

  const commandLine = ['npx', ...args]
    .map((arg) => quoteWindowsArg(arg))
    .join(' ');

  return spawnSync('cmd.exe', ['/d', '/s', '/c', commandLine], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
}

const hubRunning = await canConnectToPort(hubPort);

if (!hubRunning) {
  const message =
    `[emu:save] Emulator Hub não está acessível em 127.0.0.1:${hubPort}.`;

  if (requireRunning) {
    console.error(message);
    console.error(
      '[emu:save] Nenhum dado foi sobrescrito. Não encerre à força uma sessão que ainda possa conter estado não exportado.'
    );
    process.exit(2);
  }

  console.warn(`${message} Nada para exportar.`);
  process.exit(0);
}

let backupPath = null;

try {
  backupPath = copyExistingSnapshot();
  if (backupPath) {
    console.log(
      `[emu:save] Snapshot anterior preservado em ${path.relative(root, backupPath)}`
    );
  }
} catch (error) {
  console.error('[emu:save] Falha ao criar backup do snapshot anterior.');
  console.error(error);
  process.exit(3);
}

console.log(`[emu:save] Exportando projeto ${projectId} para ${dataDir}...`);
const result = runFirebaseExport();

if (result.error) {
  console.error('[emu:save] Falha ao executar firebase emulators:export.');
  console.error(result.error);
  process.exit(4);
}

if (result.status !== 0) {
  console.error(
    `[emu:save] Exportação terminou com código ${result.status}. Os emuladores devem permanecer ativos para evitar perda de estado.`
  );
  process.exit(result.status ?? 5);
}

if (!fs.existsSync(metadataPath)) {
  console.error(
    `[emu:save] Exportação não produziu ${path.relative(root, metadataPath)}. Os emuladores devem permanecer ativos.`
  );
  process.exit(6);
}

console.log(`[emu:save] Checkpoint concluído em ${dataDir}.`);
