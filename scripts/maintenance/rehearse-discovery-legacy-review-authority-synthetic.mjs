#!/usr/bin/env node
// Issue #236 / B2.9.2b: disposable Auth + Firestore synthetic E2E ONLY.
// No exported entrypoint, snapshot import, production access, recovery writer or deployment.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PROJECT = 'demo-entretenimento-legacy-governance';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORTS = [28080, 29099, 29150, 29400, 29450];
const DANGEROUS = [
  'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT',
  'CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'GOOGLE_CLOUD_QUOTA_PROJECT', 'FIREBASE_TOKEN', 'GOOGLE_OAUTH_ACCESS_TOKEN',
  'GOOGLE_CLOUD_ACCESS_TOKEN', 'FIREBASE_DATABASE_EMULATOR_HOST',
  'FIREBASE_STORAGE_EMULATOR_HOST',
];
const abs = relative => path.join(ROOT, relative);

function assertNoRemoteCredentials() {
  for (const key of DANGEROUS) {
    assert.equal(Object.hasOwn(process.env, key), false, 'B292B_REMOTE_CREDENTIAL');
  }
}

function verifyLocalFiles() {
  assert.equal(fs.realpathSync(process.cwd()).toLowerCase(),
    fs.realpathSync(ROOT).toLowerCase(), 'B292B_WRONG_ROOT');
  const index = fs.readFileSync(abs('functions/src/index.ts'), 'utf8');
  const source = fs.readFileSync(abs(
    'functions/src/discovery/legacy-recovery-review-authority-readonly.firestore.ts'
  ), 'utf8');
  const rules = fs.readFileSync(abs('firestore.rules'), 'utf8');
  for (const name of [
    'inspectLegacyRecoveryReviewAuthorityReadOnly',
    'inspectLegacyRecoveryAdminReadOnly',
  ]) assert.equal(index.includes(name), false, 'B292B_EXPORTED_ENTRYPOINT');
  assert.ok(source.includes('decision: \'BLOCKED\''), 'B292B_UNSAFE_REPORT');
  assert.ok(source.includes('persistentWritesAllowed: false'));
  for (const name of [
    'legacy_discovery_recovery_approvals/{operationId}',
    'legacy_discovery_preference_recovery/{ownerUid}',
  ]) assert.ok(rules.includes(`match /${name}`), 'B292B_RULES_NOT_COMPILED');
  for (const module of [
    'legacy-recovery-admin-readonly.firestore.js',
    'legacy-recovery-review-authority-readonly.firestore.js',
  ]) assert.ok(fs.statSync(abs(`functions/lib/discovery/${module}`)).isFile());
  assert.ok(fs.statSync(abs('functions/node_modules/firebase-admin')).isDirectory());
}

function available(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true },
      () => server.close(() => resolve(true)));
  });
}

async function preflight() {
  assertNoRemoteCredentials();
  for (const name of [
    'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT', 'FUNCTIONS_EMULATOR', 'FIREBASE_CONFIG',
    'FIREBASE_PROJECT_ID',
  ]) assert.equal(Object.hasOwn(process.env, name), false, 'B292B_INHERITED_RUNTIME');
  verifyLocalFiles();
  for (const port of PORTS) assert.ok(await available(port), 'B292B_PORT_BUSY');
  console.log('B2.9.2b PREFLIGHT PASS - emuladores nao iniciados');
}

function requireIsolatedRuntime() {
  assertNoRemoteCredentials();
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:28080');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:29099');
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
  assert.equal(process.env.FUNCTIONS_EMULATOR, 'true');
  if (process.env.FIREBASE_PROJECT_ID) {
    assert.equal(process.env.FIREBASE_PROJECT_ID, PROJECT);
  }
  if (process.env.FIREBASE_CONFIG) {
    const config = JSON.parse(process.env.FIREBASE_CONFIG);
    assert.equal(config.projectId, PROJECT);
  }
  verifyLocalFiles();
}

async function exercise() {
  // No Firebase import or network activity until the runtime is proven disposable.
  requireIsolatedRuntime();
  const fromFunctions = createRequire(abs('functions/package.json'));
  const { initializeApp: initializeAdmin, deleteApp: deleteAdmin } =
    fromFunctions('firebase-admin/app');
  const { getAuth: getAdminAuth } = fromFunctions('firebase-admin/auth');
  const { getFirestore: getAdminDb, FieldValue } =
    fromFunctions('firebase-admin/firestore');
  const { inspectLegacyRecoveryReviewAuthorityReadOnly } = fromFunctions(
    './lib/discovery/legacy-recovery-review-authority-readonly.firestore.js'
  );
  const { initializeApp, deleteApp } = await import('firebase/app');
  const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } =
    await import('firebase/auth');
  const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, terminate } =
    await import('firebase/firestore');

  const adminApp = initializeAdmin({ projectId: PROJECT }, 'b292b-admin');
  const clientApp = initializeApp({
    projectId: PROJECT, apiKey: 'synthetic-review-only-api-key',
    authDomain: `${PROJECT}.firebaseapp.com`,
  }, 'b292b-client');
  const auth = getAdminAuth(adminApp);
  const db = getAdminDb(adminApp);
  const clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, 'http://127.0.0.1:29099', {
    disableWarnings: true,
  });
  const clientDb = getFirestore(clientApp);
  connectFirestoreEmulator(clientDb, '127.0.0.1', 28080);
  try {
    assert.equal((await db.listCollections()).length, 0, 'B292B_DB_NOT_EMPTY');
    assert.equal((await auth.listUsers(1)).users.length, 0, 'B292B_AUTH_NOT_EMPTY');

    const password = 'Synthetic-B292b-Only-Password-345!';
    const operatorEmail = 'synthetic-operator-b292b@example.test';
    const reviewerEmail = 'synthetic-reviewer-b292b@example.test';
    const operator = await auth.createUser({
      email: operatorEmail, password, emailVerified: true,
    });
    const reviewer = await auth.createUser({
      email: reviewerEmail, password, emailVerified: true,
    });
    await auth.setCustomUserClaims(operator.uid, { admin: true });

    const operatorDoc = db.collection('users').doc(operator.uid);
    const reviewerDoc = db.collection('users').doc(reviewer.uid);
    const operationId = 'synthetic-b292b-review-operation';
    const approvalDoc = db.collection('legacy_discovery_recovery_approvals').doc(operationId);
    const baselineTime = Date.now();
    const requestedAtMs = baselineTime - 120_000;
    const approvedAtMs = baselineTime - 60_000;
    const expiresAtMs = approvedAtMs + 900_000;
    await operatorDoc.set({
      role: 'admin', accountStatus: 'active', privateRecoveryOperator: true,
    });
    await reviewerDoc.set({
      role: 'admin', accountStatus: 'active', privateRecoveryReviewer: true,
    });
    const approval = {
      schemaVersion: 1, operationId,
      purpose: 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW',
      projectId: 'entretenimento-sexual',
      targetCollection: 'legacy_discovery_preference_recovery',
      candidateCount: 2, legacyEntryCount: 8,
      requestedByUid: operator.uid, requestedAtMs,
      approvedByUid: reviewer.uid, approvedAtMs, expiresAtMs,
      revokedAtMs: null, consumedAtMs: null, expiredAtMs: null,
      status: 'APPROVED_FOR_REVIEW_ONLY', revision: 1,
    };
    await approvalDoc.set(approval);
    const login = await signInWithEmailAndPassword(
      clientAuth, operatorEmail, password
    );
    let token = await login.user.getIdToken(true);
    const checks = {};

    async function probe() {
      const before = await Promise.all(
        [operatorDoc, reviewerDoc, approvalDoc].map(async ref => (await ref.get()).data())
      );
      const reads = [];
      // The injected Firestore facade fails closed if the reader accesses any
      // private preferences or attempts to call a write method.
      const backend = {
        auth,
        firestore: {
          collection(name) {
            assert.ok(['users', 'legacy_discovery_recovery_approvals'].includes(name),
              'B292B_UNAUTHORIZED_COLLECTION');
            return {
              doc(id) {
                return {
                  get: async () => {
                    reads.push(name);
                    return db.collection(name).doc(id).get();
                  },
                };
              },
            };
          },
        },
      };
      const result = await inspectLegacyRecoveryReviewAuthorityReadOnly(
        backend, { operationId, operatorIdToken: token }
      );
      const after = await Promise.all(
        [operatorDoc, reviewerDoc, approvalDoc].map(async ref => (await ref.get()).data())
      );
      assert.deepEqual(after, before, 'B292B_READER_CHANGED_DOCS');
      assert.ok(reads.every(name =>
        name === 'users' || name === 'legacy_discovery_recovery_approvals'));
      assert.equal(result.phase, 'B2_9_2A_BACKEND_READ_ONLY');
      assert.equal(result.decision, 'BLOCKED');
      assert.equal(result.sequentialReadsOnly, true);
      for (const key of [
        'transactionAtomicityProven', 'approvalWriterIntegrated',
        'approvalConsumed', 'auditPersisted', 'privateRecoveryRead',
        'privateRecoveryWritten', 'persistentWritesAllowed',
        'sourceDeletionAllowed', 'publicVisibilityAllowed',
      ]) assert.equal(result[key], false, `B292B_${key}`);
      const serialized = JSON.stringify(result);
      for (const secret of [operator.uid, reviewer.uid, operationId, token,
        'legacyRaw', 'interestedInGenders', 'interestedInOrientations']) {
        assert.equal(serialized.includes(secret), false, 'B292B_REPORT_LEAK');
      }
      return result;
    }

    const baseline = await probe();
    for (const name of [
      'b27EvidenceCompatible', 'lifecycleSchemaCompatible',
      'lifecycleRevisionCurrent', 'principalsRechecked',
      'reviewEvidenceConsistent',
    ]) assert.equal(baseline[name], true, `B292B_BASELINE_${name}`);
    checks.baseline = true;

    await operatorDoc.update({ privateRecoveryOperator: false });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await operatorDoc.update({ privateRecoveryOperator: true });
    checks.operatorRevoked = true;

    await reviewerDoc.update({ privateRecoveryReviewer: false });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await reviewerDoc.update({ privateRecoveryReviewer: true });
    checks.reviewerRevoked = true;

    await auth.updateUser(reviewer.uid, { disabled: true });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await auth.updateUser(reviewer.uid, { disabled: false });
    checks.reviewerDisabled = true;

    await approvalDoc.update({ approvedByUid: operator.uid });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await approvalDoc.update({ approvedByUid: reviewer.uid });
    checks.selfApprovalDenied = true;

    await approvalDoc.update({ schemaVersion: 2 });
    assert.equal((await probe()).lifecycleSchemaCompatible, false);
    await approvalDoc.update({ schemaVersion: 1 });
    checks.schemaChangeDenied = true;

    await approvalDoc.update({ revision: 2 });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await approvalDoc.update({ revision: 1 });
    checks.revisionChangeDenied = true;

    await approvalDoc.update({ revokedAtMs: Date.now() });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await approvalDoc.update({ revokedAtMs: null });
    checks.revokedApproval = true;

    await approvalDoc.update({ status: 'REVOKED' });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await approvalDoc.update({ status: 'APPROVED_FOR_REVIEW_ONLY' });
    checks.terminalStatusDenied = true;

    await approvalDoc.update({ consumedAtMs: Date.now() });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await approvalDoc.update({ consumedAtMs: null });
    checks.consumedApproval = true;

    await approvalDoc.update({ expiredAtMs: Date.now() });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await approvalDoc.update({ expiredAtMs: null });
    checks.expiredMarkerDenied = true;

    await approvalDoc.update({ expiresAtMs: Date.now() - 1000 });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await approvalDoc.update({ expiresAtMs });
    checks.expiredApproval = true;

    await approvalDoc.update({ legacyRaw: ['synthetic-sentinel'] });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await approvalDoc.update({ legacyRaw: FieldValue.delete() });
    checks.extraFieldDenied = true;

    await approvalDoc.update({ targetCollection: 'public_profiles' });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await approvalDoc.update({ targetCollection: approval.targetCollection });
    checks.scopeTamperDenied = true;

    await assert.rejects(getDoc(doc(clientDb,
      'legacy_discovery_recovery_approvals', operationId)),
    error => error.code === 'permission-denied');
    await assert.rejects(setDoc(doc(clientDb,
      'legacy_discovery_recovery_approvals', 'synthetic-forged-approval'),
    { status: 'APPROVED_FOR_REVIEW_ONLY' }),
    error => error.code === 'permission-denied');
    checks.clientRulesDeny = true;

    await auth.updateUser(operator.uid, { disabled: true });
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    await auth.updateUser(operator.uid, { disabled: false });
    checks.disabledOperatorDenied = true;

    token = await login.user.getIdToken(true);
    await auth.verifyIdToken(token, true);
    await new Promise(resolve => setTimeout(resolve, 1400));
    await auth.revokeRefreshTokens(operator.uid);
    await assert.rejects(auth.verifyIdToken(token, true),
      error => error.code === 'auth/id-token-revoked');
    assert.equal((await probe()).reviewEvidenceConsistent, false);
    checks.revokedIdTokenDenied = true;

    assert.equal(
      (await db.listCollections()).some(collection =>
        collection.id === 'legacy_discovery_preference_recovery'),
      false, 'B292B_PRIVATE_RECOVERY_COLLECTION_CREATED'
    );
    assert.equal(Object.keys(checks).length, 17, 'B292B_INCOMPLETE_COVERAGE');
    assert.ok(Object.values(checks).every(x => x === true));
    console.log(JSON.stringify({
      phase: 'B2_9_2B_REAL_EMULATOR_E2E', result: 'PASS', project: PROJECT,
      checks: Object.keys(checks).length, ...checks,
      decision: 'BLOCKED', persistentWritesAllowed: false,
      privateRecoveryRead: false, privateRecoveryWritten: false,
      sourceCheckpointImported: false, productionModified: false,
      primaryEmulatorModified: false,
    }));
  } finally {
    await terminate(clientDb);
    await deleteApp(clientApp);
    await db.terminate();
    await deleteAdmin(adminApp);
  }
}

try {
  if (process.argv.length !== 3) throw new Error('B292B_FLAG_REQUIRED');
  if (process.argv[2] === '--preflight') await preflight();
  else if (process.argv[2] === '--execute') await exercise();
  else throw new Error('B292B_UNKNOWN_FLAG');
} catch {
  console.error('[B2.9.2b] FAIL - contexto sensivel omitido.');
  process.exitCode = 2;
}
