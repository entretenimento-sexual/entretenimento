// Diagnose and optionally stop ONLY the orphan Firestore process on Windows.
// Running emulators / Hub / other ports are never terminated by this command.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assessOrphanFirestore } from './orphan-firestore-stop.policy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const project = 'entretenimento-sexual';
const execute = process.argv.includes('--execute');

function shellQuote(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}
function runPowershell(script) {
  const p = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8', timeout: 15_000, windowsHide: true });
  if (p.error || p.status !== 0) {
    throw new Error('Inspeção do Windows falhou; nenhum processo foi encerrado.');
  }
  return p.stdout.trim();
}

if (process.platform !== 'win32') {
  console.error('[emu:orphan] Comando exclusivo do Windows.');
  process.exit(2);
}

const inspection = `
$ErrorActionPreference = 'Stop'
$listener = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)
$hub = @(Get-NetTCPConnection -LocalPort 4400 -State Listen -ErrorAction SilentlyContinue)
$other = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(4000,4500,5001,9099,9199,9000,8087) })
$owner = $null
if ($listener.Count -eq 1) {
  $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $listener[0].OwningProcess)
  if ($p) {
    $parent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId) -ErrorAction SilentlyContinue
    $owner = [pscustomobject]@{
      count = $listener.Count
      pid = [int]$p.ProcessId
      name = [string]$p.Name
      commandLine = [string]$p.CommandLine
      parentAlive = [bool]$parent
    }
  }
}
[pscustomobject]@{
  owner = $owner
  hubOccupied = [bool]($hub.Count -gt 0)
  otherPorts = @($other | Select-Object -ExpandProperty LocalPort -Unique)
} | ConvertTo-Json -Compress -Depth 5
`;

try {
  const state = JSON.parse(runPowershell(inspection));
  if (!state.owner && !state.hubOccupied && state.otherPorts.length === 0) {
    console.log('[emu:orphan] Nenhum Firestore Emulator órfão identificado.');
    process.exit(0);
  }
  const reason = assessOrphanFirestore({
    ...state, projectRoot: root, projectId: project,
  });
  if (reason) {
    console.error('[emu:orphan] Ação recusada: ' + reason);
    process.exit(2);
  }

  const snapshot = path.join(root, '.emulator-data', 'firebase-export-metadata.json');
  const backupDirectory = path.join(root, '.emulator-data-backups');
  const hasCheckpoint = fs.existsSync(backupDirectory) &&
    fs.readdirSync(backupDirectory).some(name =>
      name.startsWith('.emulator-data-checkpoint-'));
  if (!fs.existsSync(snapshot) || !hasCheckpoint) {
    console.error('[emu:orphan] Snapshot/checkpoint não confirmado; processo preservado.');
    process.exit(3);
  }
  console.log('[emu:orphan] Firestore órfão confirmado: PID ' + state.owner.pid);
  console.log('[emu:orphan] Snapshot exportado e checkpoint anteriores encontrados.');
  if (!execute) {
    console.log('[emu:orphan] Somente diagnóstico. Para encerrar apenas este PID: npm run emu:orphan:stop');
    process.exit(0);
  }
  console.warn('[emu:orphan] Encerramento forçado: alterações em memória após o último checkpoint podem se perder.');

  // Reinspect immediately before Stop-Process: guard against PID reuse,
  // newly started emulator suite, or a different Java executable.
  const rootLiteral = shellQuote(root.replaceAll('/', '\\').toLowerCase());
  const script = `
$ErrorActionPreference = 'Stop'
$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${state.owner.pid}'
$listen = @(Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue)
$hub = @(Get-NetTCPConnection -LocalPort 4400 -State Listen -ErrorAction SilentlyContinue)
$other = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in @(4000,4500,5001,9099,9199,9000,8087) })
if (-not $p -or $listen.Count -ne 1 -or $listen[0].OwningProcess -ne ${state.owner.pid} -or $hub.Count -ne 0 -or $other.Count -ne 0) { exit 5 }
$parent = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $p.ParentProcessId) -ErrorAction SilentlyContinue
$cmd = ([string]$p.CommandLine).ToLowerInvariant()
$root = ${rootLiteral}
if ($parent -or $p.Name -ne 'java.exe' -or
    -not $cmd.Contains('cloud-firestore-emulator-v') -or
    -not $cmd.Contains('--project_id entretenimento-sexual') -or
    -not $cmd.Contains('--port 8080') -or
    -not $cmd.Contains($root + '\\.emulator-data\\firestore_export\\') -or
    -not $cmd.Contains($root + '\\firestore.rules')) { exit 6 }
Stop-Process -Id ${state.owner.pid} -Force -ErrorAction Stop
`;
  runPowershell(script);
  console.log('[emu:orphan] Apenas o processo Firestore órfão foi encerrado.');
} catch (error) {
  console.error('[emu:orphan] Falha fechada. Nenhum encerramento adicional:', error.message);
  process.exit(4);
}
