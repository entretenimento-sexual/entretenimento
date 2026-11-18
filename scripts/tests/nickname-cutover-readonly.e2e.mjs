// Full scanner contract against a disposable demo Firestore; no production access.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const PROJECT = 'demo-nickname-audit';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
assert.equal(process.env.GCLOUD_PROJECT ?? process.env.GCP_PROJECT, PROJECT);
const app = initializeApp({ credential: applicationDefault(), projectId: PROJECT },
  'audit-test-' + randomUUID());
const db = getFirestore(app);
const temp = mkdtempSync(path.join(tmpdir(), 'nickname-scan-'));

function runScan(scriptName, count, reportEnv, limitEnv) {
  const dest = path.join(temp, randomUUID() + '.json');
  execFileSync(process.execPath, [scriptName], {
    cwd: process.cwd(),
    env: {
      ...process.env, FIREBASE_PROJECT_ID: PROJECT,
      NICKNAME_CUTOVER_APPLY: 'false',
      [reportEnv]: dest, [limitEnv]: String(count),
    },
    encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(readFileSync(dest, 'utf8'));
}
const users = cap => runScan(
  'scripts/maintenance/audit-nickname-cutover-readonly.mjs',
  cap, 'NICKNAME_AUDIT_REPORT_PATH', 'NICKNAME_AUDIT_MAX_USERS'
);
const indexes = cap => runScan(
  'scripts/maintenance/audit-nickname-index-readonly.mjs',
  cap, 'NICKNAME_INDEX_REPORT_PATH', 'NICKNAME_INDEX_MAX_RECORDS'
);

async function seed(uid, display, key) {
  await Promise.all([
    db.doc('users/' + uid).set({
      uid, nickname: display, profileCompleted: true,
      accountStatus: 'active', publicVisibility: 'visible',
      interactionBlocked: false,
    }),
    db.doc('public_profiles/' + uid).set({
      uid, nickname: display, nicknameNormalized: key,
    }),
    db.doc('public_index/nickname:' + key).set({
      uid, type: 'nickname', value: key,
    }),
  ]);
}
try {
  await seed('audit-alpha', 'Perfil Alfa', 'perfil_alfa');
  const oneUser = users(1);
  const oneIndex = indexes(1);
  assert.equal(oneUser.truncated, false);
  assert.equal(oneUser.environment, 'EMULATOR');
  assert.equal(oneUser.schemaVersion, 2);
  assert.equal(oneUser.ready, 1);
  assert.equal(oneIndex.truncated, false);
  assert.equal(oneIndex.environment, 'EMULATOR');
  assert.equal(oneIndex.schemaVersion, 2);
  assert.equal(oneIndex.already, 1);
  console.log('[nickname-audit:e2e] PASS exact-limit EOF');

  await seed('audit-beta', 'Perfil Beta', 'perfil_beta');
  assert.equal(users(1).truncated, true);
  assert.equal(indexes(1).truncated, true);
  const fullUsers = users(2);
  const fullIndexes = indexes(2);
  assert.equal(fullUsers.truncated, false);
  assert.equal(fullUsers.ready, 2);
  assert.equal(fullIndexes.truncated, false);
  assert.equal(fullIndexes.already, 2);
  assert.equal(fullIndexes.applied, 0);
  console.log('[nickname-audit:e2e] PASS overflow, complete scan, no writes');

  const obsolete = db.doc('nickname_reservations/old');
  const child = db.doc('nickname_reservations/orphan/children/example');
  await Promise.all([obsolete.set({ key: 'old' }), child.set({ key: 'example' })]);
  const cleanup = () => execFileSync(
    process.execPath, ['scripts/dev/clear-obsolete-nickname-reservations.mjs'], {
      env: { ...process.env, FIREBASE_PROJECT_ID: PROJECT },
      timeout: 60_000,
    }
  );
  cleanup();
  cleanup();
  assert.equal((await obsolete.get()).exists, false);
  assert.equal((await child.get()).exists, false);
  assert.equal((await db.collection('public_index').get()).size, 2);
  assert.equal((await db.collection('users').get()).size, 2);
  assert.equal((await db.collection('public_profiles').get()).size, 2);
  console.log('[nickname-audit:e2e] PASS cleanup deletes only obsolete emulator records and can be rerun');
} finally {
  await Promise.allSettled([
    db.recursiveDelete(db.collection('users')),
    db.recursiveDelete(db.collection('public_profiles')),
    db.recursiveDelete(db.collection('public_index')),
    db.recursiveDelete(db.collection('nickname_reservations')),
  ]);
  await deleteApp(app);
  rmSync(temp, { recursive: true, force: true });
}
