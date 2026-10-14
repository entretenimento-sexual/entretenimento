// Full-suite stop without Ctrl+C. Always checkpoint before terminating processes.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assessEmulatorSuiteShutdown } from './emulator-suite-stop.policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const execute = process.argv.includes('--execute');
const projectId = 'entretenimento-sexual';
const hubUrl = 'http://127.0.0.1:4400/';

function refuse(message) {
  console.error('[emu:stop] Operação recusada: ' + message);
  process.exit(2);
}

function spawnTool(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root, env: process.env, shell: false, windowsHide: true,
    timeout: 25_000, maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
}

const inspection = [
  "$ErrorActionPreference = 'Stop'",
  '$watch = @(4000,4400,4500,5001,8080,9099,9199,9150,9000,8087)',
  '$ports = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $watch } | ForEach-Object { [pscustomobject]@{port=[int]$_.LocalPort;pid=[int]$_.OwningProcess} })',
  '$procs = @(Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=[int]$_.ProcessId;parentPid=[int]$_.ParentProcessId;name=[string]$_.Name;commandLine=[string]$_.CommandLine} })',
  '[pscustomobject]@{listeners=$ports;processes=$procs} | ConvertTo-Json -Compress -Depth 5',
].join('\n');

function inspectProcesses() {
  const ps = spawnTool('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', inspection], {
      encoding: 'utf8',
    });
  if (ps.error || ps.status !== 0) {
    throw new Error('Falha ao inspecionar a identidade dos processos Windows.');
  }
  const state = JSON.parse(ps.stdout);
  return { listeners: state.listeners ?? [], processes: state.processes ?? [] };
}

async function inspectSuite() {
  const response = await fetch(hubUrl, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error('Emulator Hub não está acessível.');
  const payload = await response.json();
  const hubPid = Number(payload?.pid);
  const processInfo = inspectProcesses();
  const reason = assessEmulatorSuiteShutdown({ hubPid, ...processInfo, projectId });
  if (reason) throw new Error(reason);
  return { hubPid, processInfo };
}

if (process.platform !== 'win32') {
  refuse('Comando suportado somente no Windows.');
}

try {
  const before = await inspectSuite();
  console.log('[emu:stop] Suíte verificada: Firebase CLI PID ' + before.hubPid);
  if (!execute) {
    console.log('[emu:stop] Diagnóstico apenas: nenhum processo encerrado.');
    console.log('[emu:stop] Para exportar e encerrar: npm.cmd run emu:stop:win');
    process.exit(0);
  }

  console.log('[emu:stop] Salvando snapshot e checkpoint antes do encerramento...');
  const save = spawnTool(process.execPath,
    [path.join(root, 'scripts', 'dev', 'save-emulator-data.mjs'), '--require-running'], {
      stdio: 'inherit',
      timeout: 120_000,
    });
  if (save.error || save.status !== 0) {
    refuse('Exportação/checkpoint falhou. Emuladores preservados.');
  }
  const metadata = path.join(root, '.emulator-data', 'firebase-export-metadata.json');
  if (!fs.existsSync(metadata)) {
    refuse('Metadados do snapshot ausentes. Emuladores preservados.');
  }
  // Re-verify the CLI and all watched ports immediately before targeted stop.
  const after = await inspectSuite();
  if (after.hubPid !== before.hubPid) {
    refuse('Processo do Hub mudou durante o checkpoint.');
  }
  console.warn('[emu:stop] Checkpoint salvo; encerrando apenas a árvore do Firebase CLI.');
  const result = spawnTool('taskkill.exe',
    ['/PID', String(after.hubPid), '/T', '/F'], {
      stdio: 'inherit',
      timeout: 20_000,
    });
  if (result.error || result.status !== 0) {
    refuse('Encerramento da árvore falhou; verifique o diagnóstico.');
  }
  console.log('[emu:stop] Árvore da suíte encerrada. Angular na porta 4200 não foi selecionado.');
} catch (error) {
  refuse(error instanceof Error ? error.message : String(error));
}
