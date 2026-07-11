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
const ports = String(options['--ports'] || '')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);

if (!ports.length) {
  console.error('[wait] Informe ao menos uma porta em --ports.');
  process.exit(2);
}

console.log(`[wait] Aguardando ${label}: ${host}:${ports.join(', ')}.`);

try {
  await Promise.all(
    ports.map((port) => tcpPortUsed.waitUntilUsed(port, 500, timeoutMs, host))
  );
  console.log(`[wait] ${label} pronto.`);
} catch (error) {
  console.error(`[wait] Tempo esgotado aguardando ${label}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
