import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read = relative => readFileSync(
  new URL(`../../${relative}`,import.meta.url),'utf8'
).replace(/\r\n/g,'\n');
const runner=read('scripts/maintenance/rehearse-discovery-legacy-sanitization-synthetic.mjs');
const policy=read('scripts/maintenance/discovery-legacy-sanitization-synthetic.policy.mjs');
const workflow=read('.github/workflows/discovery-legacy-recovery-transaction-guard.yml');
const runtime=read('functions/src/discovery/legacy-public-profile-preservation.policy.ts');
const runtimeReader=read('functions/src/discovery/get-public-profiles-page.handler.ts');

test('runner refuses remote auth, inherited targets, ports and populated emulator',()=>{
  for(const phrase of [
    "const PROJECT = 'demo-entretenimento-legacy-governance'",
    "process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:28080'",
    "process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:29099'",
    "process.env.GCLOUD_PROJECT,PROJECT",
    "process.env.FUNCTIONS_EMULATOR,'true'",
    'GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN',
    "(await db.listCollections()).length,0",
    "(await auth.listUsers(1)).users.length,0",
    'B293G_PORT_BUSY',"process.argv[2]==='--preflight'",
    "process.argv[2]==='--exercise'",
  ])assert.ok(runner.includes(phrase),phrase);
  for(const forbidden of ['--import','--export-on-exit','.emulator-data',
    'onCall(', 'onRequest(', 'onSchedule(', 'firebase deploy']) {
    assert.equal(runner.includes(forbidden),false,forbidden);
  }
});

test('real public documents cannot be sanitized through this policy',()=>{
  assert.match(policy,/OWNER_ID = \/\^synthetic-issue236-/);
  assert.match(policy,/verifyRecoveryCandidates\(/);
  assert.match(policy,/candidateFromPublicProfile\(/);
  assert.match(policy,/assessExistingRecovery\(/);
  assert.match(policy,/B293G_PRODUCTION_SANITIZATION_DENIED/);
  assert.equal(policy.includes('firebase-admin'),false);
  assert.equal(policy.includes('firebase-functions'),false);
});

test('transaction reads owner, source, recovery before targeted field deletes',()=>{
  const firstRead=runner.indexOf('owner:await tx.get(r.owner),source:await tx.get(r.source)');
  const firstDelete=runner.indexOf('tx.update(refs[i].source,patch)');
  assert.ok(firstRead>=0 && firstDelete>firstRead);
  assert.match(runner,/planIsolatedSyntheticSanitization\(/);
  assert.match(runner,/FieldValue\.delete\(\)/);
  assert.match(runner,/RECOVERABLE_FIELDS/);
  assert.match(runner,/tx\.delete\(refs\[i\]\.recovery\)/);
  assert.match(runner,/B293G_ROLLBACK_CONFLICT/);
  assert.match(runner,/assert\.equal\(await sanitize\(\),0/);
});

test('runtime guard and backend discovery exclusion stay intact',()=>{
  assert.match(runtime,/mustHoldLegacyPublicProfileMutation/);
  assert.match(runtimeReader,/hasLegacyPrivateDiscoveryFields\(data\)/);
  assert.match(policy,/expectedSanitizedSyntheticProfile/);
});

test('CI runs policy/contract and actual demo emulator scenario on both systems',()=>{
  assert.match(workflow,/os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow,/discovery-legacy-sanitization-synthetic\.policy\.test\.mjs/);
  assert.match(workflow,/discovery-legacy-sanitization-synthetic\.contract\.test\.mjs/);
  assert.match(workflow,/rehearse-discovery-legacy-sanitization-synthetic\.mjs --preflight/);
  assert.match(workflow,/rehearse-discovery-legacy-sanitization-synthetic\.mjs --exercise/);
  assert.match(workflow,/emulators:exec --project demo-entretenimento-legacy-governance/);
});
