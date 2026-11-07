import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const runnerUrl = new URL('../maintenance/rehearse-discovery-legacy-approval-audit-atomic-synthetic.mjs',import.meta.url);
const runner = readFileSync(runnerUrl,'utf8');
const workflow = readFileSync(new URL('../../.github/workflows/discovery-legacy-recovery-transaction-guard.yml',import.meta.url),'utf8');
const productionIndex = readFileSync(new URL('../../functions/src/index.ts',import.meta.url),'utf8');
const policy = readFileSync(new URL('../maintenance/discovery-legacy-original-schema-reconciliation.policy.mjs',import.meta.url),'utf8');

function denied(args, env={}) {
  const result=spawnSync(process.execPath,[fileURLToPath(runnerUrl),...args],{
    encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH ?? '',
      SystemRoot:process.env.SystemRoot ?? '',WINDIR:process.env.WINDIR ?? '',
      TEMP:process.env.TEMP ?? '',TMP:process.env.TMP ?? '',...env},
  });
  assert.ifError(result.error);
  assert.equal(result.status,2);
  assert.equal(result.stdout,'');
  assert.match(result.stderr,/\[B2\.9\.3c\] FAIL/);
}

test('one explicit integrated flag only and unsafe commands remain denied',()=>{
  for(const args of [[],['--integrated-reconciliation','--force'],['--deploy'],
    ['--import'],['--export'],['--apply'],['--repair'],['--restore']]) denied(args);
});
test('isolated-runner environment refuses remote credentials and production project',()=>{
  for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','GCP_PROJECT','GOOGLE_CLOUD_PROJECT',
    'FIREBASE_TOKEN','GOOGLE_CLOUD_ACCESS_TOKEN']){
    denied(['--integrated-reconciliation'],{
      [key]:'unsafe',GCLOUD_PROJECT:'demo-entretenimento-legacy-governance',
      FIRESTORE_EMULATOR_HOST:'127.0.0.1:28080',
      FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:29099',FUNCTIONS_EMULATOR:'true',
    });
  }
  denied(['--integrated-reconciliation'],{
    GCLOUD_PROJECT:'entretenimento-sexual',
    FIRESTORE_EMULATOR_HOST:'127.0.0.1:28080',
    FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:29099',FUNCTIONS_EMULATOR:'true',
  });
});
test('integrated path REUSES the original B2.9.3c transaction',()=>{
  for(const phrase of [
    'async function exercise(integratedReconciliation = false)',
    'async function consumeSyntheticReviewAndAuditAtomically(',
    'db.runTransaction(async tx =>',
    'tx.get(item.approvalRef)',
    'tx.get(operatorDoc)',
    'tx.get(reviewerDoc)',
    'tx.get(item.auditRef)',
    'tx.update(item.approvalRef',
    'tx.create(item.auditRef, envelope)',
    'const success = await make(\'success\')',
    "const concurrency = await make('race')",
    "const tampered = await make('tampered')",
  ]) assert.ok(runner.includes(phrase),phrase);
});
test('original B2.9.3c legacy execution is retained',()=>{
  assert.ok(runner.includes("if (!integratedReconciliation)"));
  assert.ok(runner.includes("else if (process.argv[2] === '--execute') await exercise();"));
  assert.ok(runner.includes("else if (process.argv[2] === '--integrated-reconciliation') await exercise(true);"));
  assert.ok(runner.includes("phase:'B2_9_3C_SYNTHETIC_ATOMIC_AUDIT_E2E'"));
});
test('actual B2.9.3c document collections are read and reconciled',()=>{
  for(const phrase of [
    'ledger.get(), audit.get()',
    'reconcileOriginalB293cSyntheticDocuments({',
    'assert.equal(first.approvals.length, 13',
    'assert.equal(first.audits.length, 4',
    'matchedSyntheticPairs, 2',
    'auditWithoutConsumption, 1',
    'malformedApprovals, 2',
    'invalidAudit, 1',
  ]) assert.ok(runner.includes(phrase),phrase);
});
test('non-mutating reconciliation and aggregate-only proof are asserted',()=>{
  for(const phrase of [
    'const before = structuredClone(first)',
    'assert.deepEqual(after, before',
    "output.includes(row.id)",
    'cryptographicOperationBindingVerified, false',
    "report.decision, 'BLOCKED'",
    'report.persistentWritesAllowed, false',
    'originalDocumentsUnmodified:true',
    'fixtureAssociationOnly:true',
  ]) assert.ok(runner.includes(phrase),phrase);
});
test('no new API, callable, writer or imported private preferences',()=>{
  assert.equal(productionIndex.includes('reconcileOriginalB293cSyntheticDocuments'),false);
  assert.equal(productionIndex.includes('integrated-reconciliation'),false);
  for(const marker of ['firebase-admin','getFirestore(','db.collection(','tx.update(',
    'tx.create(','onCall(','onRequest(','onSchedule(','process.env']){
    assert.equal(policy.includes(marker),false,marker);
  }
  for(const marker of ['emulators:export','firebase deploy','--seed_from_export']){
    assert.equal(runner.includes(marker),false,marker);
  }
});
test('CI runs both contracts and real original-schema emulator E2E on Windows and Ubuntu',()=>{
  assert.ok(workflow.replace(/\r\n/g, '\n').includes('matrix:\n        os: [ubuntu-latest, windows-latest]'));
  assert.ok(workflow.includes('Guard consolidated original-schema pure reconciliation'));
  assert.ok(workflow.includes('Guard consolidated original-schema integrated runner'));
  assert.ok(workflow.includes('B2.9.3f original-schema reconciliation E2E'));
  assert.ok(workflow.includes('--integrated-reconciliation'));
  assert.ok(workflow.includes('--project demo-entretenimento-legacy-governance'));
  assert.ok(workflow.includes('--only auth,firestore'));
  assert.ok(workflow.includes('--config firebase.legacy-governance-e2e.json'));
  assert.ok(workflow.includes('persist-credentials: false'));
});
