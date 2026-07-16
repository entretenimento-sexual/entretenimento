import net from 'node:net';

const HOST = '127.0.0.1';
const REQUIRED_PORTS = [4000, 4200, 4400, 4500, 5001, 8080, 9099, 9199];
const CONNECT_TIMEOUT_MS = 800;
const HTTP_TIMEOUT_MS = 2_500;

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

async function isExpectedSessionHealthy() {
  const [angular, firebaseUi] = await Promise.all([
    fetchText(`http://${HOST}:4200/`),
    fetchText(`http://${HOST}:4000/`),
  ]);

  const angularSignature =
    angular.ok && /<app-root(?:\s|>)/i.test(angular.text);
  const firebaseSignature =
    firebaseUi.ok &&
    /Firebase Emulator Suite|firebase-emulator-ui|emulator suite/i.test(
      firebaseUi.text
    );

  return {
    healthy: angularSignature && firebaseSignature,
    angularStatus: angular.status,
    firebaseUiStatus: firebaseUi.status,
    angularSignature,
    firebaseSignature,
  };
}

const states = await Promise.all(REQUIRED_PORTS.map(checkPort));
const occupiedPorts = states.filter((state) => state.used).map((state) => state.port);
const freePorts = states.filter((state) => !state.used).map((state) => state.port);

if (occupiedPorts.length === 0) {
  console.log('[dev:session] Todas as portas esperadas estão livres.');
  process.exit(0);
}

if (freePorts.length > 0) {
  console.error('[dev:session] Ambiente local parcialmente ocupado.');
  console.error(`[dev:session] Portas ocupadas: ${occupiedPorts.join(', ')}.`);
  console.error(`[dev:session] Portas livres: ${freePorts.join(', ')}.`);
  process.exit(1);
}

const health = await isExpectedSessionHealthy();

if (health.healthy) {
  console.log('[dev:session] Angular e Firebase já estão ativos e saudáveis.');
  process.exit(10);
}

console.error('[dev:session] Todas as portas estão ocupadas, mas a sessão não foi reconhecida como saudável.');
console.error(
  `[dev:session] Angular status=${health.angularStatus} assinatura=${health.angularSignature}.`
);
console.error(
  `[dev:session] Firebase UI status=${health.firebaseUiStatus} assinatura=${health.firebaseSignature}.`
);
process.exit(1);
