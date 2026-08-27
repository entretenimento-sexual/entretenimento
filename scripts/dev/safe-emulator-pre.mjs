// scripts/dev/safe-emulator-pre.mjs
// -----------------------------------------------------------------------------
// LIMPEZA SEGURA DAS PORTAS DO FIREBASE EMULATOR
// -----------------------------------------------------------------------------
// Substitui o antigo `kill-port ... || exit 0`.
//
// Regra principal:
// - se algum emulador com estado estiver ativo, primeiro cria checkpoint;
// - se o Hub estiver indisponível ou o checkpoint falhar, não mata processos;
// - somente depois de um checkpoint válido libera as portas conhecidas.
// -----------------------------------------------------------------------------

import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const hubPort = Number(process.env.FIREBASE_EMULATOR_HUB_PORT || 4400);
const knownPorts = [4000, 4400, 4500, 9099, 8080, 5001, 8087, 9000, 9199, 9150];
const statefulPorts = [9099, 8080, 5001, 8087, 9000, 9199];
const saveScript = path.resolve(root, 'scripts', 'dev', 'save-emulator-data.mjs');

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

    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function quoteWindowsArg(value) {
  const normalized = String(value ?? '');

  if (/^[A-Za-z0-9_/:=.,@+\-]+$/.test(normalized)) {
    return normalized;
  }

  return `"${normalized.replace(/"/g, '\\"')}"`;
}

function runCommand(command, args) {
  if (process.platform !== 'win32') {
    return spawnSync(command, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      shell: false,
    });
  }

  const commandLine = [command, ...args]
    .map((arg) => quoteWindowsArg(arg))
    .join(' ');

  return spawnSync('cmd.exe', ['/d', '/s', '/c', commandLine], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
}

const portStates = await Promise.all(
  knownPorts.map(async (port) => ({
    port,
    open: await canConnectToPort(port),
  }))
);

const openPorts = portStates.filter((item) => item.open).map((item) => item.port);

if (openPorts.length === 0) {
  console.log('[emu:pre] Nenhuma porta conhecida do Emulator está ocupada.');
  process.exit(0);
}

const openStatefulPorts = openPorts.filter((port) => statefulPorts.includes(port));

if (openStatefulPorts.length > 0) {
  if (!openPorts.includes(hubPort)) {
    console.error(
      `[emu:pre] Emuladores com estado estão ativos nas portas ${openStatefulPorts.join(', ')}, mas o Hub ${hubPort} não responde.`
    );
    console.error(
      '[emu:pre] Limpeza abortada para não perder dados. Encerre a sessão manualmente somente se aceitar descartar o estado não exportado.'
    );
    process.exit(2);
  }

  console.log('[emu:pre] Criando checkpoint antes de liberar portas...');
  const saveResult = spawnSync(process.execPath, [saveScript, '--require-running'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  if (saveResult.error || saveResult.status !== 0) {
    console.error(
      '[emu:pre] Checkpoint falhou. Nenhuma porta será encerrada automaticamente.'
    );
    process.exit(saveResult.status ?? 3);
  }
}

console.log(`[emu:pre] Liberando portas conhecidas: ${openPorts.join(', ')}.`);
const killResult = runCommand('npx', ['kill-port', ...openPorts.map(String)]);

if (killResult.error) {
  console.error('[emu:pre] Falha ao executar kill-port após o checkpoint seguro.');
  console.error(killResult.error);
  process.exit(4);
}

if (killResult.status !== 0) {
  console.error(`[emu:pre] kill-port terminou com código ${killResult.status}.`);
  process.exit(killResult.status ?? 5);
}

console.log('[emu:pre] Portas liberadas após checkpoint seguro.');
