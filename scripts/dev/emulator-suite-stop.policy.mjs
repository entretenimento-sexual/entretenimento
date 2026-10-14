// Pure shutdown policy. Ports alone never authorize process termination.
const WATCHED_PORTS = new Set([4000,4400,4500,5001,8080,9099,9199,9150,9000,8087]);
const ALLOWED_CHILD_NAMES = new Set(['node.exe','java.exe','cmd.exe','ffmpeg.exe']);
const lower = value => String(value ?? '').replaceAll('\\','/').toLowerCase();

function belongsToTree(processId, hubPid, byId) {
  let cursor = Number(processId);
  const visited = new Set();
  for (let i = 0; i < 30 && cursor > 0 && !visited.has(cursor); i++) {
    if (cursor === hubPid) return true;
    visited.add(cursor);
    cursor = Number(byId.get(cursor)?.parentPid ?? 0);
  }
  return false;
}

export function assessEmulatorSuiteShutdown({
  hubPid, processes = [], listeners = [], projectId = 'entretenimento-sexual',
} = {}) {
  if (!Number.isSafeInteger(hubPid) || hubPid <= 0) return 'PID do Hub inválido.';
  const byId = new Map(processes.map(p => [Number(p.pid), p]));
  const hub = byId.get(hubPid);
  const hubListeners = listeners.filter(p => Number(p.port) === 4400);
  if (hubListeners.length !== 1 || Number(hubListeners[0].pid) !== hubPid) {
    return 'O PID informado pelo Hub não possui exclusivamente a porta 4400.';
  }
  if (!hub || lower(hub.name) !== 'node.exe') return 'O Hub não é o processo Node esperado.';
  const cmd = lower(hub.commandLine);
  if (projectId !== 'entretenimento-sexual') return 'Projeto Firebase não autorizado neste launcher.';
  if (!cmd.includes('firebase') || !cmd.includes('emulators:start') ||
      !/(?:^|\s)--project(?:=|\s+)entretenimento-sexual(?:\s|$)/.test(cmd)) {
    return 'O processo não corresponde ao Firebase CLI e projeto esperado.';
  }

  let parent = Number(hub.parentPid ?? 0);
  let launcherFound = false;
  const visited = new Set([hubPid]);
  for (let i = 0; i < 20 && parent > 0 && !visited.has(parent); i++) {
    visited.add(parent);
    const item = byId.get(parent);
    if (!item) break;
    if (lower(item.commandLine).includes('start-emulator-with-data.mjs')) {
      launcherFound = true;
      break;
    }
    parent = Number(item.parentPid ?? 0);
  }
  if (!launcherFound) return 'Launcher canônico não identificado entre os processos pais.';

  for (const item of listeners) {
    if (WATCHED_PORTS.has(Number(item.port)) &&
        !belongsToTree(item.pid, hubPid, byId)) {
      return 'A porta ' + item.port + ' pertence a outra árvore de processos.';
    }
  }
  for (const item of processes) {
    if (Number(item.pid) !== hubPid &&
        belongsToTree(item.pid, hubPid, byId) &&
        !ALLOWED_CHILD_NAMES.has(lower(item.name))) {
      return 'Processo filho inesperado (PID ' + item.pid + '); operação recusada.';
    }
  }
  return null;
}
