// Isolated, ephemeral Firestore integration for video reconciliation.
// Never import/export the developer's .emulator-data or use port 8080.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
const cli = require.resolve('firebase-tools/lib/bin/firebase.js');
const projectId = 'demo-entretenimento-video-reconciliation';

async function freePort() {
  const server = createServer();
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  const port = server.address().port;
  await new Promise((resolveClosed, reject) => {
    server.close(error => error ? reject(error) : resolveClosed());
  });
  return port;
}

const folder = await mkdtemp(join(tmpdir(), 'video-reconciliation-firestore-'));
try {
  const ports = new Set();
  // An isolated WebSocket port is required too: the developer suite uses 9150.
  while (ports.size < 4) ports.add(await freePort());
  const [firestore, hub, logging, websocket] = [...ports];
  if ([firestore, hub, logging, websocket].some(port =>
    [8080, 9150, 4000, 4400, 4500].includes(port)
  )) {
    throw new Error('Refusing to reuse development emulator ports.');
  }

  // firestore.rules is generated and is not present in clean checkouts.
  const rulesBuilder = resolve(
    root, 'firestore-rules/tools-rules/build-firestore-rules.mjs'
  );
  const rulesBuild = spawnSync(process.execPath, [rulesBuilder], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });
  if (rulesBuild.error || rulesBuild.status !== 0) {
    throw new Error(
      'Cannot generate canonical Firestore Rules for isolated test.'
    );
  }

  const rules = resolve(root, 'firestore.rules');
  const indexes = resolve(root, 'firestore.indexes.json');
  await Promise.all([access(rules), access(indexes)]);
  const config = join(folder, 'firebase.json');
  await writeFile(config, JSON.stringify({
    firestore: { rules, indexes },
    emulators: {
      singleProjectMode: true,
      firestore: {
        host: '127.0.0.1',
        port: firestore,
        websocketPort: websocket,
      },
      hub: { host: '127.0.0.1', port: hub },
      logging: { host: '127.0.0.1', port: logging },
      ui: { enabled: false },
    },
  }), 'utf8');

  const command = [
    'node --test --test-concurrency=1',
    'functions/lib/media/application/video-processing-reconciliation.emulator.test.js',
    'functions/lib/media/application/video-source-probe.emulator.test.js',
    'functions/lib/media/application/video-immutable-input-preflight.emulator.test.js',
  ].join(' ');
  const child = spawn(process.execPath, [
    cli, 'emulators:exec', '--only', 'firestore',
    '--project', projectId, '--config', config, command,
  ], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      GOOGLE_APPLICATION_CREDENTIALS: '',
      FIREBASE_AUTH_EMULATOR_HOST: '',
      FIREBASE_STORAGE_EMULATOR_HOST: '',
      CLOUD_TASKS_EMULATOR_HOST: '',
      FIRESTORE_EMULATOR_HOST: '',
      FUNCTIONS_EMULATOR: '',
      GCLOUD_PROJECT: projectId,
      GOOGLE_CLOUD_PROJECT: projectId,
      GCP_PROJECT: projectId,
      VIDEO_RECONCILE_EXPECTED_EMULATOR_HOST: `127.0.0.1:${firestore}`,
    },
  });
  const code = await new Promise((resolveClose, reject) => {
    child.once('error', reject);
    child.once('close', exitCode => resolveClose(exitCode));
  });
  if (code !== 0) process.exitCode = code ?? 1;
} finally {
  await rm(folder, { recursive: true, force: true });
}
