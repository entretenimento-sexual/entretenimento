// Executa somente a integração do Direct Chat em um Firestore Emulator isolado.
// Não reutiliza nem encerra os emuladores do desenvolvimento.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

const directory = await mkdtemp(join(tmpdir(), 'chat-reconciliation-emulator-'));
try {
  const ports = new Set();
  while (ports.size < 3) ports.add(await availablePort());
  const [firestore, hub, logging] = [...ports];
  const config = join(directory, 'firebase.json');
  await writeFile(config, JSON.stringify({
    emulators: {
      singleProjectMode: true,
      firestore: { host: '127.0.0.1', port: firestore },
      hub: { host: '127.0.0.1', port: hub },
      logging: { host: '127.0.0.1', port: logging },
      ui: { enabled: false },
    },
  }), 'utf8');

  // Uma única linha de shell preserva o argumento de comando do emulators:exec
  // no cmd.exe. spawn(firebase.cmd, args, { shell: true }) perdia as aspas.
  const command = [
    'firebase emulators:exec --only firestore',
    '--project demo-entretenimento',
    `--config "${config}"`,
    '"node --test functions/lib/chat/direct-chat/application/direct-chat-reconciliation.reader.emulator.test.js"',
  ].join(' ');
  const child = spawn(command, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      GOOGLE_APPLICATION_CREDENTIALS: '',
      FIRESTORE_EMULATOR_HOST: '',
      GCLOUD_PROJECT: 'demo-entretenimento',
      GOOGLE_CLOUD_PROJECT: 'demo-entretenimento',
      GCP_PROJECT: 'demo-entretenimento',
    },
  });
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => resolve(exitCode));
  });
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}
