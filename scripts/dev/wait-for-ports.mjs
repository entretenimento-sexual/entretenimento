import net from 'node:net';

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...value] = arg.split('=');
    return [key, value.join('=')];
  })
);

const host = options['--host'] || '127.0.0.1';
const timeoutMs = Number(options['--timeout'] || 180000);
const label = options['--label'] || 'serviços locais';
const expectedState = options['--state'] === 'free' ? 'free' : 'used';
const pollingIntervalMs = Math.max(
  100,
  Number(options['--interval'] || (expectedState === 'free' ? 250 : 500))
);
const ports = String(options['--ports'] || '')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

if (!ports.length) {
  console.error('[wait] Informe ao menos uma porta em --ports.');
  process.exit(2);
}

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error('[wait] Informe um timeout positivo em --timeout.');
  process.exit(2);
}

if (!Number.isFinite(pollingIntervalMs) || pollingIntervalMs <= 0) {
  console.error('[wait] Informe um intervalo positivo em --interval.');
  process.exit(2);
}

const stateLabel = expectedState === 'free' ? 'livres' : 'disponíveis';
console.log(
  `[wait] Aguardando ${label}: ${host}:${ports.join(', ')} ${stateLabel}.`
);

const sleep = (durationMs) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

function isPortUsed(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (used) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(used);
    };

    socket.setTimeout(Math.min(1000, pollingIntervalMs));
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function readPortStates() {
  return Promise.all(
    ports.map(async (port) => ({
      port,
      used: await isPortUsed(port),
    }))
  );
}

function pendingPorts(states) {
  return states
    .filter((state) =>
      expectedState === 'free' ? state.used : !state.used
    )
    .map((state) => state.port);
}

const startedAt = Date.now();
let pending = [...ports];

while (Date.now() - startedAt <= timeoutMs) {
  const states = await readPortStates();
  pending = pendingPorts(states);

  if (pending.length === 0) {
    console.log(`[wait] ${label} pronto.`);
    process.exit(0);
  }

  await sleep(pollingIntervalMs);
}

console.error(
  `[wait] Timeout aguardando ${label}. Portas pendentes: ${pending.join(', ')}.`
);
process.exit(1);
