import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runner = fileURLToPath(new URL(
  '../maintenance/rehearse-discovery-legacy-review-authority-synthetic.mjs',
  import.meta.url
));
const index = fileURLToPath(new URL('../../functions/src/index.ts', import.meta.url));
const source = readFileSync(runner, 'utf8');

function blocked(args, envAdd = {}) {
  const proc = spawnSync(process.execPath, [runner, ...args], {
    env: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      WINDIR: process.env.WINDIR ?? '',
      TEMP: process.env.TEMP ?? '',
      TMP: process.env.TMP ?? '',
      ...envAdd,
    },
    encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(proc.error);
  assert.equal(proc.status, 2);
  assert.equal(proc.stdout, '');
  assert.match(proc.stderr, /\[B2\.9\.2b\] FAIL/);
}

test('explicit flags only; never run by default or with override flags', () => {
  for (const args of [[], ['--deploy'], ['--execute', '--force'],
    ['--migrate'], ['--apply'], ['--export']]) blocked(args);
});

test('refuses inherited emulator, project and functions contexts', () => {
  for (const key of [
    'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT', 'FUNCTIONS_EMULATOR', 'FIREBASE_CONFIG',
    'FIREBASE_PROJECT_ID',
  ]) blocked(['--preflight'], { [key]: 'unexpected' });
});

test('rejects remote cloud credentials and production project', () => {
  for (const key of [
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT',
    'GCP_PROJECT', 'CLOUDSDK_CORE_PROJECT',
    'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE', 'FIREBASE_TOKEN',
    'GOOGLE_CLOUD_QUOTA_PROJECT',
  ]) blocked(['--preflight'], { [key]: 'synthetic-only' });
  blocked(['--execute'], {
    GCLOUD_PROJECT: 'entretenimento-sexual',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:28080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:29099',
    FUNCTIONS_EMULATOR: 'true',
  });
});

test('requires empty disposable Auth and Firestore before synthetic writes', () => {
  assert.match(source, /db\.listCollections\(\)/);
  assert.match(source, /auth\.listUsers\(1\)/);
  assert.match(source, /B292B_DB_NOT_EMPTY/);
  assert.match(source, /B292B_AUTH_NOT_EMPTY/);
});

test('new reader is backend-only, unexported and always blocked', () => {
  const exported = readFileSync(index, 'utf8');
  assert.equal(exported.includes('inspectLegacyRecoveryReviewAuthorityReadOnly'), false);
  assert.equal(exported.includes('legacy-recovery-review-authority-readonly.firestore'), false);
  assert.match(source, /inspectLegacyRecoveryReviewAuthorityReadOnly/);
  assert.match(source, /persistentWritesAllowed: false/);
  assert.match(source, /privateRecoveryRead: false/);
  assert.match(source, /privateRecoveryWritten: false/);
});

test('covers real emulator negative states and rule denial', () => {
  for (const marker of [
    'checks.baseline = true', 'checks.operatorRevoked = true',
    'checks.reviewerRevoked = true', 'checks.reviewerDisabled = true',
    'checks.selfApprovalDenied = true', 'checks.schemaChangeDenied = true',
    'checks.revisionChangeDenied = true', 'checks.revokedApproval = true',
    'checks.consumedApproval = true', 'checks.expiredApproval = true',
    'checks.clientRulesDeny = true', 'checks.revokedIdTokenDenied = true',
  ]) assert.ok(source.includes(marker), marker);
});

test('reader can only read allowed private administrative evidence', () => {
  assert.match(source, /B292B_UNAUTHORIZED_COLLECTION/);
  assert.match(source, /'legacy_discovery_recovery_approvals'/);
  assert.match(source, /'users'/);
  assert.match(source, /B292B_READER_CHANGED_DOCS/);
  assert.match(source, /B292B_PRIVATE_RECOVERY_COLLECTION_CREATED/);
});

test('no migration, production deployment or snapshot import mechanism', () => {
  for (const banned of [
    '--seed_from_export', '--import', '--export-on-exit',
    'emulators:export', 'firebase deploy', '.emulator-data',
    'serviceAccount',
  ]) assert.equal(source.includes(banned), false, banned);
});

test('CI only runs against disposable Auth and Firestore project', () => {
  const workflow = readFileSync(new URL(
    '../../.github/workflows/discovery-legacy-recovery-transaction-guard.yml',
    import.meta.url
  ), 'utf8');
  const job = workflow.split('  real-emulator-e2e:')[1];
  assert.ok(job);
  assert.match(job, /B2\.9\.2b real Auth \+ Firestore synthetic E2E/);
  assert.match(job, /--project demo-entretenimento-legacy-governance/);
  assert.match(job, /--only auth,firestore/);
  assert.match(job, /--config firebase\.legacy-governance-e2e\.json/);
  assert.match(job, /rehearse-discovery-legacy-review-authority-synthetic\.mjs --execute/);
  assert.doesNotMatch(job, /--import|--export-on-exit|firebase deploy/);
});
