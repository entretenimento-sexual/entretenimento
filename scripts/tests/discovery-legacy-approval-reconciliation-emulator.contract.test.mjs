import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const runner = fileURLToPath(new URL(
  '../maintenance/rehearse-discovery-legacy-approval-reconciliation-synthetic.mjs',
  import.meta.url
));
const source = readFileSync(runner, 'utf8');
const index = readFileSync(new URL('../../functions/src/index.ts', import.meta.url), 'utf8');
const workflow = readFileSync(new URL(
  '../../.github/workflows/discovery-legacy-recovery-transaction-guard.yml',
  import.meta.url
), 'utf8');

function deny(args, addition = {}) {
  const child = spawnSync(process.execPath, [runner, ...args], {
    env: {
      PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '',
      WINDIR: process.env.WINDIR ?? '', TEMP: process.env.TEMP ?? '',
      TMP: process.env.TMP ?? '', ...addition,
    },
    encoding: 'utf8', timeout: 10_000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 2);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /\[B2\.9\.3e\] FAIL/);
}

test('fails closed with missing, excess and unauthorized flags', () => {
  for (const args of [[], ['--apply'], ['--repair'], ['--delete'],
    ['--deploy'], ['--import'], ['--export'],
    ['--execute', '--force'], ['--preflight', '--execute']]) deny(args);
});

test('preflight rejects inherited emulator and Firebase runtime values', () => {
  for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT', 'FUNCTIONS_EMULATOR', 'FIREBASE_CONFIG',
    'FIREBASE_PROJECT_ID']) deny(['--preflight'], { [key]: 'unsafe' });
});

test('preflight denies remote credentials and production project before SDK load', () => {
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT',
    'GCP_PROJECT', 'CLOUDSDK_CORE_PROJECT',
    'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE', 'GOOGLE_CLOUD_QUOTA_PROJECT',
    'FIREBASE_TOKEN']) deny(['--preflight'], { [key]: 'unsafe' });
  deny(['--execute'], {
    GCLOUD_PROJECT: 'entretenimento-sexual',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:28080',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:29099',
    FUNCTIONS_EMULATOR: 'true',
  });
});

test('requires exact localhost ports and disposable empty Firestore/Auth stores', () => {
  for (const token of [
    'PORTS', 'portFree(', 'B293E_PORT_BUSY',
    "'127.0.0.1:28080'", "'127.0.0.1:29099'",
    'db.listCollections()', 'auth.listUsers(1)',
    'B293E_DB_NOT_EMPTY', 'B293E_AUTH_NOT_EMPTY',
    "'demo-entretenimento-legacy-governance'",
  ]) assert.ok(source.includes(token), token);
});

test('creates fixtures only inside two new synthetic emulator collections', () => {
  assert.match(source, /approvals: 'synthetic_b293e_approval_fixtures'/);
  assert.match(source, /audits: 'synthetic_b293e_audit_fixtures'/);
  assert.match(source, /ref\.doc\(docId\)\.create\(fixtures\[kind\]\[i\]\)/);
  assert.match(source, /const names = \(await db\.listCollections\(\)\)/);
  assert.match(source, /assert\.deepEqual\(names, Object\.values\(COLLECTIONS\)\.sort\(\)\)/);
});

test('reads both collections from Firestore and applies strict projection field allowlists', () => {
  for (const token of [
    'approvalsRef.get()', 'auditsRef.get()',
    'safeProjection(approvalsSnapshot', 'safeProjection(auditsSnapshot',
    'exactKeys(data, fields)', 'KEY_RE.test(data.syntheticKey)',
    'DOCUMENT_RE.test(doc.id)', 'B293E_UNTRUSTED_PROJECTION',
  ]) assert.ok(source.includes(token), token);
});

test('runs the existing B2.9.3d pure reconciliation policy over queried data', () => {
  assert.match(source, /import \{ reconcileSyntheticReviewApprovals \}/);
  assert.match(source, /const read = await readSyntheticProjections\(\)/);
  assert.match(source, /const report = reconcileSyntheticReviewApprovals\(\{/);
  assert.match(source, /approvals: read\.approvals/);
  assert.match(source, /audits: read\.audits/);
});

test('requires actual coherent consumed/audit pair from emulator', () => {
  assert.match(source, /assert\.equal\(report\.matchedSyntheticPairs, 1\)/);
  assert.match(source, /checks\.matchedReadPair = true/);
});

test('detects missing and orphan audit entries read from emulator', () => {
  assert.match(source, /assert\.equal\(report\.missingAudit, 1\)/);
  assert.match(source, /assert\.equal\(report\.orphanAudit, 1\)/);
});

test('rejects unaudited/nonconsumed and stale-revision approvals', () => {
  assert.match(source, /assert\.equal\(report\.auditWithoutConsumption, 2\)/);
  assert.match(source, /assert\.equal\(report\.invalidRevision, 1\)/);
});

test('detects scope, timeline, digest and timestamp inconsistencies', () => {
  for (const token of [
    'report.invalidScope, 1', 'report.invalidTimeline, 1',
    'report.invalidAudit, 1', 'report.timestampMismatch, 2',
  ]) assert.ok(source.includes(token), token);
});

test('duplicate fixture associations never reconcile optimistically', () => {
  assert.match(source, /assert\.equal\(report\.duplicateApprovalKeys, 1\)/);
  assert.match(source, /assert\.equal\(report\.duplicateAuditKeys, 1\)/);
  assert.match(source, /assert\.equal\(report\.shapeReconciled, false\)/);
});

test('verifies snapshots remain unchanged after running the reconciler', () => {
  assert.match(source, /const before = structuredClone\(read\)/);
  assert.match(source, /const after = await readSyntheticProjections\(\)/);
  assert.match(source, /assert\.deepEqual\(before, after\)/);
});

test('report is aggregate-only with blocked actions and no identifiers', () => {
  for (const token of [
    "assert.equal(report.decision, 'BLOCKED')",
    "'persistentWritesAllowed'", "'automatedRepairAllowed'",
    "'privateRecoveryRead'", "'privateRecoveryWritten'",
    'serialized.includes(row.syntheticKey)',
    "'entryHash'", "'previousHash'",
  ]) assert.ok(source.includes(token), token);
  assert.match(source, /checks: 20,/);
});

test('Auth remains empty and private recovery collection is never accessed', () => {
  assert.match(source, /checks\.authRemainedEmpty = true/);
  assert.match(source, /checks\.onlyDisposableCollections = true/);
  assert.doesNotMatch(source, /db\.collection\('legacy_discovery_preference_recovery'\)/);
  assert.doesNotMatch(source, /db\.collection\('legacy_discovery_recovery_approvals'\)/);
});

test('no live writer, trigger, production entrypoint, repair or deploy is introduced', () => {
  assert.equal(index.includes('reconcileSyntheticEmulatorReviewFixtures'), false);
  for (const forbidden of [
    'onCall(', 'onRequest(', 'onSchedule(', 'firebase deploy',
    'emulators:export', '--export-on-exit', '--seed_from_export',
    '.delete(', '.update(', 'tx.update(', 'tx.delete(',
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});

test('CI tests new runner on Windows/Ubuntu with only disposable emulators', () => {
  assert.match(workflow, /Guard B2\.9\.3e emulator reconciliation runner contracts/);
  assert.match(workflow, /B2\.9\.3e real synthetic reconciliation E2E/);
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  const step = workflow.split('      - name: B2.9.3e real synthetic reconciliation E2E')[1];
  assert.ok(step);
  assert.match(step, /--project demo-entretenimento-legacy-governance/);
  assert.match(step, /--only auth,firestore/);
  assert.match(step, /rehearse-discovery-legacy-approval-reconciliation-synthetic\.mjs --execute/);
  assert.doesNotMatch(step, /--import|--export-on-exit|firebase deploy/);
});
