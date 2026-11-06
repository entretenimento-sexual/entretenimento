import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const runner = fileURLToPath(new URL(
  '../maintenance/rehearse-discovery-legacy-approval-audit-atomic-synthetic.mjs',
  import.meta.url
));
const source = readFileSync(runner, 'utf8');
const index = readFileSync(new URL('../../functions/src/index.ts', import.meta.url), 'utf8');
const workflow = readFileSync(new URL(
  '../../.github/workflows/discovery-legacy-recovery-transaction-guard.yml',
  import.meta.url
), 'utf8');

function mustFail(args, addEnv = {}) {
  const child = spawnSync(process.execPath, [runner, ...args], {
    env: {
      PATH:process.env.PATH ?? '', SystemRoot:process.env.SystemRoot ?? '',
      WINDIR:process.env.WINDIR ?? '', TEMP:process.env.TEMP ?? '',
      TMP:process.env.TMP ?? '', ...addEnv,
    },
    encoding:'utf8', timeout:10000,
  });
  assert.ifError(child.error);
  assert.equal(child.status, 2);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /\[B2\.9\.3c\] FAIL/);
}

test('requires one explicit safe flag; no implicit or override execution', () => {
  for (const args of [[], ['--apply'], ['--execute','--force'],
    ['--deploy'], ['--export'], ['--import'], ['--migrate']]) mustFail(args);
});

test('rejects inherited Firebase environment before any SDK import', () => {
  for (const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT','FUNCTIONS_EMULATOR','FIREBASE_CONFIG','FIREBASE_PROJECT_ID']) {
    mustFail(['--preflight'], {[key]:'unsafe'});
  }
});

test('rejects remote credentials, production project and cloud project overrides', () => {
  for (const key of ['GOOGLE_APPLICATION_CREDENTIALS','GOOGLE_CLOUD_PROJECT',
    'GCP_PROJECT','CLOUDSDK_CORE_PROJECT',
    'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE','GOOGLE_CLOUD_QUOTA_PROJECT',
    'FIREBASE_TOKEN']) mustFail(['--preflight'], {[key]:'unsafe'});
  mustFail(['--execute'], { GCLOUD_PROJECT:'entretenimento-sexual',
    FIRESTORE_EMULATOR_HOST:'127.0.0.1:28080',
    FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:29099',
    FUNCTIONS_EMULATOR:'true' });
});

test('requires an empty disposable project and exact isolated ports', () => {
  for (const token of ['db.listCollections()', 'auth.listUsers(1)',
    'B293C_DB_NOT_EMPTY','B293C_AUTH_NOT_EMPTY','B293C_PORT_BUSY',
    "'127.0.0.1:28080'", "'127.0.0.1:29099'",
    "'demo-entretenimento-legacy-governance'"]) assert.ok(source.includes(token),token);
});

test('transaction reads both principals, approval and audit in one read phase', () => {
  for (const token of ['db.runTransaction(', 'tx.get(item.approvalRef)',
    'tx.get(operatorDoc)', 'tx.get(reviewerDoc)', 'tx.get(item.auditRef)',
    'privateRecoveryOperator', 'privateRecoveryReviewer',
    'eligible(approval.data()', 'auditExisting.exists'])
    assert.ok(source.includes(token), token);
});

test('single transaction updates ledger and creates audit; forced error rolls both back', () => {
  assert.match(source, /tx\.update\(item\.approvalRef/);
  assert.match(source, /tx\.create\(item\.auditRef, envelope\)/);
  assert.match(source, /B293C_FORCED_ROLLBACK/);
  assert.match(source, /assert\.deepEqual\(\(await rollback\.approvalRef\.get\(\)\)\.data\(\), oldApproval\)/);
  assert.match(source, /assert\.equal\(\(await rollback\.auditRef\.get\(\)\)\.exists, false\)/);
});

test('six contenders permit exactly one pair and no replay', () => {
  for (const marker of ['length:6', 'winners.length, 1',
    'checks.concurrentSinglePair = true','checks.replayDenied = true',
    'checks.atomicPairCommitted = true']) assert.ok(source.includes(marker),marker);
});

test('rejects stale revision, existing audit, revoked, expired and invalid scope', () => {
  for (const marker of ['checks.preexistingAuditDenied = true',
    'checks.staleRevisionDenied = true', 'checks.revokedDenied = true',
    'checks.expiredDenied = true', 'checks.scopeTamperingDenied = true',
    'checks.extraFieldDenied = true', 'checks.selfApprovalDenied = true'])
    assert.ok(source.includes(marker),marker);
});

test('checks current operator/reviewer permission and synthetic audit tampering', () => {
  for (const marker of ['checks.operatorPrivilegeDenied = true',
    'checks.reviewerPrivilegeDenied = true',
    'checks.auditTamperingDetected = true',
    'verifySyntheticReviewAuditChain(', 'appendSyntheticReviewAuditEvent('])
    assert.ok(source.includes(marker),marker);
});

test('new audit payload is anonymous, bounded and cannot authorize recovery', () => {
  assert.match(source,/const audit = db\.collection\('synthetic_legacy_review_audit_b293c'\)/);
  assert.match(source,/return \{schemaVersion:1, entries\}/);
  assert.match(source,/noPrivateRecoveryCollection = true/);
  for (const pattern of ['persistentWritesAllowed:false',
    'approvalWriterIntegrated:false','auditProductionPersisted:false',
    'privateRecoveryRead:false','privateRecoveryWritten:false'])
    assert.ok(source.includes(pattern),pattern);
  assert.equal(index.includes('consumeSyntheticReviewAndAuditAtomically'), false);
});

test('runner forbids import/export/deploy and cannot be used as production entrypoint', () => {
  for (const forbidden of ['--seed_from_export','--export-on-exit',
    'emulators:export','firebase deploy','initializeApp({ projectId: \'entretenimento-sexual\'',
    'onCall(', 'onRequest(', 'onSchedule('])
    assert.equal(source.includes(forbidden), false, forbidden);
});

test('CI includes same disposable emulator runner for Windows and Ubuntu', () => {
  assert.match(workflow,/Guard B2\.9\.3c atomic review audit transaction runner contracts/);
  assert.match(workflow,/B2\.9\.3c real synthetic atomic audit E2E/);
  assert.match(workflow,/matrix:\s*\n\s*os: \[ubuntu-latest, windows-latest\]/);
  const step = workflow.split('      - name: B2.9.3c real synthetic atomic audit E2E')[1];
  assert.ok(step);
  assert.match(step,/--project demo-entretenimento-legacy-governance/);
  assert.match(step,/--only auth,firestore/);
  assert.match(step,/--config firebase\.legacy-governance-e2e\.json/);
  assert.match(step,/rehearse-discovery-legacy-approval-audit-atomic-synthetic\.mjs --execute/);
  assert.doesNotMatch(step,/--import|--export-on-exit|firebase deploy/);
});
