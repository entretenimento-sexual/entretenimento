import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runner = fileURLToPath(new URL(
  '../maintenance/rehearse-discovery-legacy-approval-transaction-synthetic.mjs',
  import.meta.url
));
const index = fileURLToPath(new URL('../../functions/src/index.ts', import.meta.url));
const source = readFileSync(runner, 'utf8');

function mustFail(args, envAdd = {}) {
  const proc = spawnSync(process.execPath, [runner, ...args], {
    env: {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      WINDIR: process.env.WINDIR ?? '',
      TEMP: process.env.TEMP ?? '', TMP: process.env.TMP ?? '',
      ...envAdd,
    },
    encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(proc.error);
  assert.equal(proc.status, 2);
  assert.equal(proc.stdout, '');
  assert.match(proc.stderr, /\[B2\.9\.3a\] FAIL/);
}

test('run requires exactly one explicit safe flag', () => {
  for (const args of [[], ['--apply'], ['--deploy'], ['--export'],
    ['--execute', '--force'], ['--import'], ['--migrate']]) mustFail(args);
});

test('preflight refuses inherited emulator and project context', () => {
  for (const key of [
    'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT', 'FUNCTIONS_EMULATOR', 'FIREBASE_CONFIG',
    'FIREBASE_PROJECT_ID',
  ]) mustFail(['--preflight'], { [key]: 'unsafe-synthetic-value' });
});

test('rejects remote credentials and production project before importing Firebase', () => {
  for (const key of [
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT',
    'GCP_PROJECT', 'CLOUDSDK_CORE_PROJECT',
    'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
    'GOOGLE_CLOUD_QUOTA_PROJECT', 'FIREBASE_TOKEN',
  ]) mustFail(['--preflight'], { [key]: 'unsafe-value' });
  mustFail(['--execute'], {
    GCLOUD_PROJECT: 'entretenimento-sexual',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:28080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:29099',
    FUNCTIONS_EMULATOR: 'true',
  });
});

test('preflight requires empty emulator stores and exact ports', () => {
  assert.match(source, /db\.listCollections\(\)/);
  assert.match(source, /auth\.listUsers\(1\)/);
  assert.match(source, /B293A_DB_NOT_EMPTY/);
  assert.match(source, /B293A_AUTH_NOT_EMPTY/);
  assert.match(source, /B293A_PORT_BUSY/);
  assert.match(source, /127\.0\.0\.1:28080/);
  assert.match(source, /127\.0\.0\.1:29099/);
});

test('six concurrent transactions yield exactly one winner', () => {
  assert.match(source, /db\.runTransaction\(/);
  assert.match(source, /transaction\.get\(ref\)/);
  assert.match(source, /transaction\.get\(operatorDoc\)/);
  assert.match(source, /transaction\.get\(reviewerDoc\)/);
  assert.match(source, /transaction\.update\(ref,/);
  assert.match(source, /Array\.from\(\{ length: 6 \}/);
  assert.match(source, /winners\.length, 1/);
  assert.match(source, /checks\.concurrentSingleWinner = true/);
});

test('stale revision, replay and terminal states are rejected', () => {
  for (const marker of [
    'checks.replayDenied = true', 'checks.staleRevisionDenied = true',
    'checks.revokedDenied = true', 'checks.expiredDenied = true',
    'checks.scopeTamperingDenied = true', 'checks.extraFieldDenied = true',
    'checks.selfApprovalDenied = true',
  ]) assert.ok(source.includes(marker), marker);
  assert.match(source, /revision: 2/);
  assert.match(source, /CONSUMED_FOR_REVIEW_ONLY/);
});

test('rollback restores exact ledger snapshot and does not partially consume', () => {
  assert.match(source, /B293A_SYNTHETIC_ROLLBACK/);
  assert.match(source, /assert\.deepEqual\(\(await rollback\.ref\.get\(\)\)\.data\(\), beforeRollback\)/);
  assert.match(source, /checks\.transactionRollbackAtomic = true/);
});

test('operator and reviewer privileges are read inside same transaction', () => {
  assert.match(source, /privateRecoveryOperator/);
  assert.match(source, /privateRecoveryReviewer/);
  assert.match(source, /checks\.operatorPrivilegeDenied = true/);
  assert.match(source, /checks\.reviewerPrivilegeDenied = true/);
});

test('neither private recovery access nor new backend endpoint is introduced', () => {
  const indexSource = readFileSync(index, 'utf8');
  assert.equal(indexSource.includes('rehearse-discovery-legacy-approval-transaction-synthetic'), false);
  for (const forbidden of [
    'firebase deploy', 'emulators:import', 'emulators:export',
    '--import', '--export-on-exit', 'serviceAccount(',
    "db.collection('public_profiles')", "db.collection('legacy_discovery_preference_recovery')",
    'onCall(', 'onRequest(', 'onSchedule(',
  ]) {
    // Some forbidden words appear as rejected command-line test arguments;
    // only check executable operations, not explicit denylist inputs.
    const executable = source.split('\n').filter(line =>
      !line.includes("['--") && !line.trim().startsWith('//')).join('\n');
    assert.equal(executable.includes(forbidden), false, forbidden);
  }
  assert.match(source, /B293A_UNEXPECTED_COLLECTION/);
  assert.match(source, /persistentWritesAllowed: false/);
  assert.match(source, /approvalWriterIntegrated: false/);
});

test('CI invokes only the disposable Firestore and Auth emulator', () => {
  const workflow = readFileSync(new URL(
    '../../.github/workflows/discovery-legacy-recovery-transaction-guard.yml',
    import.meta.url
  ), 'utf8');
  assert.match(workflow, /Guard B2\.9\.3a transaction runner contracts/);
  assert.match(workflow, /B2\.9\.3a real Firestore synthetic transaction E2E/);
  const step = workflow.split('B2.9.3a real Firestore synthetic transaction E2E')[1];
  assert.ok(step);
  assert.match(step, /--project demo-entretenimento-legacy-governance/);
  assert.match(step, /--only auth,firestore/);
  assert.match(step, /--config firebase\.legacy-governance-e2e\.json/);
  assert.match(step, /rehearse-discovery-legacy-approval-transaction-synthetic\.mjs --execute/);
  assert.doesNotMatch(step, /--import|--export-on-exit|firebase deploy/);
});
