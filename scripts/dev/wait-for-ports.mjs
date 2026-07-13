import tcpPortUsed from 'tcp-port-used';

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

const stateLabel = expectedState === 'free' ? 'livres' : 'disponíveis';
console.log(
  `[wait] Aguardando ${label}: ${host}:${ports.join(', ')} ${stateLabel}.`
);

try {
  await Promise.all(
    ports.map((port) =>
      expectedState === 'free'
        ? tcpPortUsed.waitUntilFree(port, 250, timeoutMs, host)
        : tcpPortUsed.waitUntilUsed(port, 500, timeoutMs, host)
    )
  );
  console.log(`[wait] ${label} pronto.`);
} catch (error) {
  const action = expectedState === 'free' ? 'liberação de' : 'disponibilidade de';
  console.error(`[wait] Tempo esgotado aguardando ${action} ${label}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
