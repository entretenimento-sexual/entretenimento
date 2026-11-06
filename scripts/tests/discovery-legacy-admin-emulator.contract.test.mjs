import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runner = fileURLToPath(new URL(
  '../maintenance/rehearse-discovery-legacy-admin-synthetic.mjs',
  import.meta.url
));

const index = fileURLToPath(new URL(
  '../../functions/src/index.ts',
  import.meta.url
));

const source = readFileSync(runner, 'utf8');

function invoke(args, extraEnv = {}) {
  const env = {
    PATH: process.env.PATH ?? '',
    SystemRoot: process.env.SystemRoot ?? '',
    WINDIR: process.env.WINDIR ?? '',
    TEMP: process.env.TEMP ?? '',
    TMP: process.env.TMP ?? '',
    ...extraEnv,
  };

  const result = spawnSync(
    process.execPath,
    [runner, ...args],
    {
      env,
      encoding: 'utf8',
      timeout: 10000,
    }
  );

  assert.ifError(result.error);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.match(
    result.stderr,
    /\[B2\.8\.2\] FAIL/
  );
}

test('requires an explicit permitted execution flag', () => {
  for (const args of [
    [],
    ['--apply'],
    ['--deploy'],
    ['--export'],
    ['--execute', '--force'],
    ['--unknown'],
  ]) {
    invoke(args);
  }
});

test('rejects inherited emulator and project contexts', () => {
  for (const name of [
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT',
    'FUNCTIONS_EMULATOR',
    'FIREBASE_CONFIG',
    'FIREBASE_PROJECT_ID',
  ]) {
    invoke(['--preflight'], {
      [name]: 'unsafe-inherited-value',
    });
  }
});

test('rejects remote credential configuration', () => {
  for (const name of [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT',
    'GCP_PROJECT',
    'CLOUDSDK_CORE_PROJECT',
    'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
    'GOOGLE_CLOUD_QUOTA_PROJECT',
    'FIREBASE_TOKEN',
  ]) {
    invoke(['--preflight'], {
      [name]: 'synthetic-secret-value',
    });
  }
});

test('rejects the production project before SDK use', () => {
  invoke(['--execute'], {
    GCLOUD_PROJECT: 'entretenimento-sexual',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:28080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:29099',
    FUNCTIONS_EMULATOR: 'true',
  });
});

test('requires empty synthetic Auth and Firestore', () => {
  assert.match(source, /db\.listCollections\(\)/);
  assert.match(source, /adminAuth\.listUsers\(1\)/);
  assert.match(source, /B2_8_DATABASE_NOT_EMPTY/);
  assert.match(source, /B2_8_AUTH_NOT_EMPTY/);
});

test('preserves the internal reader boundary', () => {
  const exports = readFileSync(index, 'utf8');

  assert.equal(
    exports.includes('inspectLegacyRecoveryAdminReadOnly'),
    false
  );

  assert.match(
    source,
    /inspectLegacyRecoveryAdminReadOnly/
  );

  assert.match(source, /persistentWritesAllowed/);
  assert.match(source, /privateRecoveryRead/);
  assert.match(source, /privateRecoveryWritten/);
  assert.match(source, /sourceCheckpointImported: false/);
});

test('does not introduce migration or deployment commands', () => {
  for (const forbidden of [
    '--seed_from_export',
    'emulators:export',
    'firebase deploy',
    'emulators:import',
  ]) {
    assert.equal(source.includes(forbidden), false);
  }
});
test('B2.8 CI config is strictly isolated', () => {
  const config = JSON.parse(readFileSync(
    new URL('../../firebase.legacy-governance-e2e.json', import.meta.url),
    'utf8'
  ));

  assert.deepEqual(config, {
    firestore: {
      rules: 'firestore.rules',
    },
    emulators: {
      singleProjectMode: true,
      ui: { enabled: false },
      auth: { host: '127.0.0.1', port: 29099 },
      firestore: {
        host: '127.0.0.1',
        port: 28080,
        websocketPort: 29150,
      },
      hub: { host: '127.0.0.1', port: 29400 },
      logging: { host: '127.0.0.1', port: 29450 },
    },
  });
});

test('B2.8 CI invokes only the isolated real emulator E2E', () => {
  const workflow = readFileSync(
    new URL(
      '../../.github/workflows/discovery-legacy-recovery-transaction-guard.yml',
      import.meta.url
    ),
    'utf8'
  );

  const job = workflow.split('  real-emulator-e2e:')[1];

  assert.ok(job, 'B2.8 real E2E job missing');
  assert.match(job, /setup-java@v4/);
  assert.match(job, /persist-credentials: false/);
  assert.match(job, /emulators:exec/);
  assert.match(
    job,
    /--project demo-entretenimento-legacy-governance/
  );
  assert.match(job, /--only auth,firestore/);
  assert.match(
    job,
    /--config firebase\.legacy-governance-e2e\.json/
  );
  assert.match(
    job,
    /rehearse-discovery-legacy-admin-synthetic\.mjs --execute/
  );
  assert.doesNotMatch(
    job,
    /--import|--export-on-exit|firebase deploy/
  );
});