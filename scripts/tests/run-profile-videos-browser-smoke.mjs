import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import { once } from 'node:events';

const HOST = '127.0.0.1';
const PORT = 4200;
const BASE_URL = `http://${HOST}:${PORT}`;
const START_TIMEOUT_MS = 120_000;
const LOG_DIR = 'logs/profile-videos-browser-smoke';
const LOG_PATH = `${LOG_DIR}/ng-serve.log`;

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function normalizeHost(value) {
  return String(value ?? '')
    .trim()
    .replace(/^https?:\/\//i, '');
}

function assertEmulatorEnvironment() {
  const expected = {
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
  };

  for (const [key, expectedValue] of Object.entries(expected)) {
    const received = normalizeHost(process.env[key]);

    if (received !== expectedValue) {
      throw new Error(
        `[profile-videos:browser-smoke] ${key} inválido. ` +
          `Esperado ${expectedValue}; recebido ${received || 'vazio'}.`
      );
    }
  }

  const storageHost = normalizeHost(
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ??
      process.env.STORAGE_EMULATOR_HOST
  );

  if (storageHost !== '127.0.0.1:9199') {
    throw new Error(
      '[profile-videos:browser-smoke] Storage Emulator não está isolado em ' +
        `127.0.0.1:9199. Recebido: ${storageHost || 'vazio'}.`
    );
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForApplication(url) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });

      if (response.ok || response.status === 304) {
        return;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(500);
  }

  throw new Error(
    `[profile-videos:browser-smoke] Angular não respondeu em ${url}. ` +
      `Último erro: ${String(lastError ?? 'indisponível')}`
  );
}

async function stopProcessTree(child) {
  if (!child?.pid || child.exitCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }

  await Promise.race([once(child, 'exit'), delay(5_000)]);

  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

async function run() {
  assertEmulatorEnvironment();
  mkdirSync(LOG_DIR, { recursive: true });

  const logStream = createWriteStream(LOG_PATH, { flags: 'w' });
  const angular = spawn(
    npmCommand,
    ['run', 'start:emu', '--', '--host', HOST, '--port', String(PORT)],
    {
      cwd: process.cwd(),
      env: process.env,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  angular.stdout.on('data', (chunk) => {
    logStream.write(chunk);
    process.stdout.write(chunk);
  });
  angular.stderr.on('data', (chunk) => {
    logStream.write(chunk);
    process.stderr.write(chunk);
  });

  let exitCode = 1;

  try {
    await waitForApplication(`${BASE_URL}/login`);

    const playwright = spawn(
      npxCommand,
      [
        'playwright',
        'test',
        '--config=playwright.profile-videos.config.mjs',
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PROFILE_VIDEOS_BASE_URL: BASE_URL,
        },
        stdio: 'inherit',
      }
    );

    const [code, signal] = await once(playwright, 'exit');

    if (signal) {
      throw new Error(
        `[profile-videos:browser-smoke] Playwright interrompido por ${signal}.`
      );
    }

    exitCode = Number.isInteger(code) ? code : 1;
  } finally {
    await stopProcessTree(angular);
    logStream.end();
  }

  process.exitCode = exitCode;
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
