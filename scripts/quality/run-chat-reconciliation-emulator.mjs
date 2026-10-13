// Executa somente a integração do Direct Chat em um Firestore Emulator isolado.
// Não reutiliza nem encerra os emuladores do desenvolvimento.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const firebaseCli = require.resolve('firebase-tools/lib/bin/firebase.js');

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
  const rules = resolve('firestore.rules');
  await access(rules);
  const config = join(directory, 'firebase.json');
  await writeFile(config, JSON.stringify({
    firestore: { rules },
    emulators: {
      singleProjectMode: true,
      firestore: { host: '127.0.0.1', port: firestore },
      hub: { host: '127.0.0.1', port: hub },
      logging: { host: '127.0.0.1', port: logging },
      ui: { enabled: false },
    },
  }), 'utf8');

  // Node executa o CLI diretamente: preserva o comando do emulators:exec
  // como argumento único em Windows e Linux, sem expansão pelo cmd.exe.
  const testCommand = [
    'node --test',
    'functions/lib/chat/direct-chat/application/direct-chat-reconciliation.reader.emulator.test.js',
    'functions/lib/chat/direct-chat/application/reconcile-direct-chat-access.handler.test.js',
    'functions/lib/chat/direct-chat/application/ensure-direct-chat.handler.test.js',
    'functions/lib/chat/direct-chat/application/send-direct-message.handler.test.js',
    'functions/lib/chat/direct-chat/application/delete-direct-message.handler.test.js',
    // Reconciliador e auditoria unread precisam rodar com emulador real.
    'functions/lib/chat/direct-chat/application/sync-direct-unread-projection.emulator.test.js',
    'functions/lib/chat/direct-chat/application/direct-unread-backfill.audit.emulator.test.js',
    'functions/lib/chat/direct-chat/application/direct-unread-backfill.emulator.test.js',
  ].join(' ');
  const args = [
    'emulators:exec',
    '--only', 'firestore',
    '--project', 'demo-entretenimento',
    '--config', config,
    testCommand,
  ];
  const child = spawn(process.execPath, [firebaseCli, ...args], {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      GOOGLE_APPLICATION_CREDENTIALS: '',
      FIRESTORE_EMULATOR_HOST: '',
      CHAT_RECONCILIATION_EXPECTED_EMULATOR_HOST: `127.0.0.1:${firestore}`,
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
