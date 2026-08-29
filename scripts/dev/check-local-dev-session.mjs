import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const HOST = '127.0.0.1';
const REQUIRED_PORTS = [4000, 4200, 4400, 4500, 5001, 8080, 9099, 9199];
const CONNECT_TIMEOUT_MS = 800;
const HTTP_TIMEOUT_MS = 2_500;
const PROJECT_ROOT = process.cwd();
const SESSION_HEAD_PATH = path.join(
  PROJECT_ROOT,
  '.dev-logs',
  'angular-session-head.txt'
);

function checkPort(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: HOST, port });
    let settled = false;

    const finish = (used) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve({ port, used });
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
    });

    return {
      ok: response.status < 500,
      status: response.status,
      text: await response.text(),
    };
  } catch {
    return { ok: false, status: 0, text: '' };
  } finally {
    clearTimeout(timeout);
  }
}

function getCurrentHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

async function getSessionHead() {
  try {
    return (await readFile(SESSION_HEAD_PATH, 'utf8')).trim();
  } catch {
    return '';
  }
}

async function isExpectedSessionHealthy() {
  const [angular, firebaseUi, sessionHead] = await Promise.all([
    fetchText(`http://${HOST}:4200/`),
    fetchText(`http://${HOST}:4000/`),
    getSessionHead(),
  ]);

  const currentHead = getCurrentHead();
  const angularSignature =
    angular.ok && /<app-root(?:\s|>)/i.test(angular.text);
  const firebaseSignature =
    firebaseUi.ok &&
    /Firebase Emulator Suite|firebase-emulator-ui|emulator suite/i.test(
      firebaseUi.text
    );
  const headMatches = Boolean(
    currentHead && sessionHead && currentHead === sessionHead
  );

  return {
    healthy: angularSignature && firebaseSignature && headMatches,
    angularStatus: angular.status,
    firebaseUiStatus: firebaseUi.status,
    angularSignature,
    firebaseSignature,
    headMatches,
    currentHead,
    sessionHead,
  };
}

const states = await Promise.all(REQUIRED_PORTS.map(checkPort));
const occupiedPorts = states.filter((state) => state.used).map((state) => state.port);
const freePorts = states.filter((state) => !state.used).map((state) => state.port);

if (occupiedPorts.length === 0) {
  console.log('[dev:session] Todas as portas esperadas estão livres.');
  process.exitCode = 0;
} else if (freePorts.length > 0) {
  console.error('[dev:session] Ambiente local parcialmente ocupado.');
  console.error(`[dev:session] Portas ocupadas: ${occupiedPorts.join(', ')}.`);
  console.error(`[dev:session] Portas livres: ${freePorts.join(', ')}.`);
  process.exitCode = 1;
} else {
  const health = await isExpectedSessionHealthy();

  if (health.healthy) {
    console.log(
      `[dev:session] Angular e Firebase ativos no HEAD ${health.currentHead}.`
    );
    process.exitCode = 10;
  } else {
    console.error(
      '[dev:session] Todas as portas estão ocupadas, mas a sessão não corresponde ao estado atual do projeto.'
    );
    console.error(
      `[dev:session] Angular status=${health.angularStatus} assinatura=${health.angularSignature}.`
    );
    console.error(
      `[dev:session] Firebase UI status=${health.firebaseUiStatus} assinatura=${health.firebaseSignature}.`
    );
    console.error(
      `[dev:session] HEAD atual=${health.currentHead || 'indisponível'} sessão=${health.sessionHead || 'indisponível'} correspondência=${health.headMatches}.`
    );
    process.exitCode = 1;
  }
}
