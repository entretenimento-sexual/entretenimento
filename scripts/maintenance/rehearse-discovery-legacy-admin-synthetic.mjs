#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const PROJECT = 'demo-entretenimento-legacy-governance';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORTS = [28080, 29099, 29150, 29400, 29450];

const DANGEROUS_ENV = [
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'GCP_PROJECT',
  'CLOUDSDK_CORE_PROJECT',
  'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'GOOGLE_CLOUD_QUOTA_PROJECT',
  'FIREBASE_TOKEN',
  'GOOGLE_OAUTH_ACCESS_TOKEN',
  'GOOGLE_CLOUD_ACCESS_TOKEN',
  'FIREBASE_DATABASE_EMULATOR_HOST',
  'FIREBASE_STORAGE_EMULATOR_HOST',
];

const abs = rel => path.join(ROOT, rel);

function verifyFiles() {
  assert.equal(
    fs.realpathSync(process.cwd()).toLowerCase(),
    fs.realpathSync(ROOT).toLowerCase()
  );

  const reader = fs.readFileSync(
    abs('functions/src/discovery/legacy-recovery-admin-readonly.firestore.ts'),
    'utf8'
  );
  const index = fs.readFileSync(abs('functions/src/index.ts'), 'utf8');
  const rules = fs.readFileSync(abs('firestore.rules'), 'utf8');

  assert.ok(reader.includes('request.operatorIdToken, true'));
  assert.ok(reader.includes("'127.0.0.1:28080'"));
  assert.ok(reader.includes("'127.0.0.1:29099'"));
  assert.ok(reader.includes('persistentWritesAllowed: false'));
  assert.ok(!index.includes('inspectLegacyRecoveryAdminReadOnly'));
  assert.ok(!index.includes('legacy-recovery-admin-readonly.firestore'));

  for (const collection of [
    'legacy_discovery_recovery_approvals/{operationId}',
    'legacy_discovery_preference_recovery/{ownerUid}',
  ]) {
    assert.ok(rules.includes(`match /${collection}`));
  }

  assert.ok((rules.match(/allow read, write: if false;/g) ?? []).length >= 4);
  assert.ok(fs.statSync(
    abs('functions/lib/discovery/legacy-recovery-admin-readonly.firestore.js')
  ).isFile());
  assert.ok(fs.statSync(
    abs('functions/node_modules/firebase-admin')
  ).isDirectory());
}

function noDangerousEnv() {
  for (const name of DANGEROUS_ENV) {
    assert.ok(!Object.hasOwn(process.env, name), 'B2_8_UNSAFE_ENV');
  }
}

function isFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(
      { host: '127.0.0.1', port, exclusive: true },
      () => server.close(() => resolve(true))
    );
  });
}

async function preflight() {
  noDangerousEnv();

  for (const name of [
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT',
    'FUNCTIONS_EMULATOR',
    'FIREBASE_CONFIG',
    'FIREBASE_PROJECT_ID',
  ]) {
    assert.ok(!Object.hasOwn(process.env, name), 'B2_8_EXISTING_RUNTIME');
  }

  verifyFiles();

  for (const port of PORTS) {
    assert.ok(await isFree(port), 'B2_8_PORT_BUSY');
  }

  console.log('B2.8.2 PREFLIGHT PASS - emuladores nao iniciados');
}

function exactRuntime() {
  noDangerousEnv();

  assert.equal(
    process.env.FIRESTORE_EMULATOR_HOST,
    '127.0.0.1:28080'
  );
  assert.equal(
    process.env.FIREBASE_AUTH_EMULATOR_HOST,
    '127.0.0.1:29099'
  );
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
  assert.equal(process.env.FUNCTIONS_EMULATOR, 'true');

  if (process.env.FIREBASE_PROJECT_ID) {
    assert.equal(process.env.FIREBASE_PROJECT_ID, PROJECT);
  }

  if (process.env.FIREBASE_CONFIG) {
    const config = JSON.parse(process.env.FIREBASE_CONFIG);
    assert.equal(config.projectId, PROJECT);
  }

  verifyFiles();
}

async function exercise() {
  // Validar isolamento antes de importar os SDKs.
  exactRuntime();

  const requireFunctions = createRequire(abs('functions/package.json'));

  const {
    initializeApp: initializeAdmin,
    deleteApp: deleteAdmin,
  } = requireFunctions('firebase-admin/app');

  const { getAuth: getAdminAuth } =
    requireFunctions('firebase-admin/auth');

  const { getFirestore: getAdminDb } =
    requireFunctions('firebase-admin/firestore');

  const { inspectLegacyRecoveryAdminReadOnly } = requireFunctions(
    './lib/discovery/legacy-recovery-admin-readonly.firestore.js'
  );

  const { initializeApp, deleteApp } = await import('firebase/app');

  const {
    getAuth,
    connectAuthEmulator,
    signInWithEmailAndPassword,
  } = await import('firebase/auth');

  const {
    getFirestore,
    connectFirestoreEmulator,
    doc,
    getDoc,
    setDoc,
    terminate,
  } = await import('firebase/firestore');

  const adminApp = initializeAdmin(
    { projectId: PROJECT },
    'b28-admin'
  );

  const clientApp = initializeApp({
    projectId: PROJECT,
    apiKey: 'synthetic-test-api-key',
    authDomain: `${PROJECT}.firebaseapp.com`,
  }, 'b28-client');

  const adminAuth = getAdminAuth(adminApp);
  const db = getAdminDb(adminApp);

  const clientAuth = getAuth(clientApp);
  connectAuthEmulator(
    clientAuth,
    'http://127.0.0.1:29099',
    { disableWarnings: true }
  );

  const clientDb = getFirestore(clientApp);
  connectFirestoreEmulator(clientDb, '127.0.0.1', 28080);

  try {
    assert.equal(
      (await db.listCollections()).length,
      0,
      'B2_8_DATABASE_NOT_EMPTY'
    );

    assert.equal(
      (await adminAuth.listUsers(1)).users.length,
      0,
      'B2_8_AUTH_NOT_EMPTY'
    );

    const password = 'Synthetic-Only-Test-23567!';

    const operator = await adminAuth.createUser({
      email: 'synthetic-operator-b28@example.test',
      password,
      emailVerified: true,
    });

    const reviewer = await adminAuth.createUser({
      email: 'synthetic-reviewer-b28@example.test',
      password,
      emailVerified: true,
    });

    await adminAuth.setCustomUserClaims(
      operator.uid,
      { admin: true }
    );

    const operatorDoc = db.collection('users').doc(operator.uid);
    const reviewerDoc = db.collection('users').doc(reviewer.uid);

    const operationId = 'synthetic-b28-review-operation';

    const approvalDoc = db
      .collection('legacy_discovery_recovery_approvals')
      .doc(operationId);

    const now = Date.now();

    await operatorDoc.set({
      role: 'admin',
      accountStatus: 'active',
      privateRecoveryOperator: true,
    });

    await reviewerDoc.set({
      role: 'admin',
      accountStatus: 'active',
      privateRecoveryReviewer: true,
    });

    await approvalDoc.set({
      operationId,
      purpose: 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW',
      status: 'APPROVED_FOR_REVIEW_ONLY',
      projectId: 'entretenimento-sexual',
      targetCollection: 'legacy_discovery_preference_recovery',
      candidateCount: 2,
      legacyEntryCount: 8,
      requestedByUid: operator.uid,
      approvedByUid: reviewer.uid,
      approvedAtMs: now - 60000,
      expiresAtMs: now + 600000,
      revokedAtMs: null,
      consumedAtMs: null,
    });

    const credential = await signInWithEmailAndPassword(
      clientAuth,
      'synthetic-operator-b28@example.test',
      password
    );

    let token = await credential.user.getIdToken(true);
    const evidence = {};

    async function probe() {
      const refs = [operatorDoc, reviewerDoc, approvalDoc];

      const before = await Promise.all(
        refs.map(async ref => (await ref.get()).data())
      );

      const privateBefore = (
        await db.collection('legacy_discovery_preference_recovery')
          .limit(1).get()
      ).size;

      const result = await inspectLegacyRecoveryAdminReadOnly({
        auth: adminAuth,
        firestore: db,
      }, {
        operationId,
        operatorIdToken: token,
      });

      const after = await Promise.all(
        refs.map(async ref => (await ref.get()).data())
      );

      const privateAfter = (
        await db.collection('legacy_discovery_preference_recovery')
          .limit(1).get()
      ).size;

      assert.deepEqual(after, before, 'B2_8_READER_MUTATED_DOCS');
      assert.equal(privateBefore, 0);
      assert.equal(privateAfter, 0);
      assert.equal(result.decision, 'BLOCKED');

      for (const field of [
        'backendWriterIntegrated',
        'approvalRecordConsumed',
        'auditPersisted',
        'privateRecoveryRead',
        'privateRecoveryWritten',
        'ownerConsentEstablished',
        'persistentWritesAllowed',
        'sourceFieldsDeletionAllowed',
        'visibilityActivationAllowed',
      ]) {
        assert.equal(result[field], false, field);
      }

      return result;
    }

    const baseline = await probe();

    for (const field of [
      'identityReadVerified',
      'operatorPrivilegeCurrent',
      'reviewerPrivilegeCurrent',
      'reviewerIndependent',
      'approvalRecordConsistent',
    ]) {
      assert.equal(baseline[field], true, `BASELINE_${field}`);
    }

    evidence.baseline = true;

    // Mesmo JWT, privilegio atual removido.
    await operatorDoc.update({ role: 'free' });
    assert.equal(await credential.user.getIdToken(), token);
    assert.equal((await probe()).operatorPrivilegeCurrent, false);
    await operatorDoc.update({ role: 'admin' });
    evidence.staleJwtPrivilegeRevoked = true;

    // Revogacao do revisor.
    await reviewerDoc.update({ privateRecoveryReviewer: false });
    assert.equal((await probe()).approvalRecordConsistent, false);
    await reviewerDoc.update({ privateRecoveryReviewer: true });
    evidence.reviewerRevoked = true;

    // Impedir autoaprovacao.
    await approvalDoc.update({ approvedByUid: operator.uid });
    assert.equal((await probe()).reviewerIndependent, false);
    await approvalDoc.update({ approvedByUid: reviewer.uid });
    evidence.independentReviewer = true;

    // Expiracao.
    await approvalDoc.update({ expiresAtMs: Date.now() - 1000 });
    assert.equal((await probe()).approvalRecordConsistent, false);
    await approvalDoc.update({ expiresAtMs: Date.now() + 600000 });
    evidence.expiredApproval = true;

    // Aprovacao revogada.
    await approvalDoc.update({ status: 'REVOKED' });
    assert.equal((await probe()).approvalRecordConsistent, false);
    await approvalDoc.update({ status: 'APPROVED_FOR_REVIEW_ONLY' });
    evidence.revokedApproval = true;

    // Aprovacao consumida.
    await approvalDoc.update({ consumedAtMs: Date.now() });
    assert.equal((await probe()).approvalRecordConsistent, false);
    await approvalDoc.update({ consumedAtMs: null });
    evidence.consumedApproval = true;

    // Cliente autenticado nao consegue acessar o ledger.
    await assert.rejects(
      getDoc(doc(
        clientDb,
        'legacy_discovery_recovery_approvals',
        operationId
      )),
      error => error.code === 'permission-denied'
    );

    await assert.rejects(
      setDoc(
        doc(
          clientDb,
          'legacy_discovery_recovery_approvals',
          'synthetic-forged-approval'
        ),
        { status: 'APPROVED_FOR_REVIEW_ONLY' }
      ),
      error => error.code === 'permission-denied'
    );

    evidence.clientRulesDeny = true;

    // Conta desabilitada.
    await adminAuth.updateUser(operator.uid, { disabled: true });
    assert.equal((await probe()).identityReadVerified, false);
    await adminAuth.updateUser(operator.uid, { disabled: false });
    evidence.disabledUserDenied = true;

    // Reautenticar para provar revogacao de token ainda valido.
    const freshLogin = await signInWithEmailAndPassword(
      clientAuth,
      'synthetic-operator-b28@example.test',
      password
    );

    token = await freshLogin.user.getIdToken(true);

    await adminAuth.verifyIdToken(token, true);

    // Separar os segundos de autenticacao e revogacao.
    await new Promise(resolve => setTimeout(resolve, 1300));

    await adminAuth.revokeRefreshTokens(operator.uid);

    await assert.rejects(
      adminAuth.verifyIdToken(token, true),
      error => error.code === 'auth/id-token-revoked'
    );

    assert.equal((await probe()).identityReadVerified, false);
    evidence.revokedIdTokenDenied = true;

    assert.ok(Object.values(evidence).every(value => value === true));

    console.log(JSON.stringify({
      phase: 'B2_8_2_REAL_EMULATOR_E2E',
      result: 'PASS',
      project: PROJECT,
      checks: Object.keys(evidence).length,
      ...evidence,
      decision: 'BLOCKED',
      persistentWritesAllowed: false,
      privateRecoveryRead: false,
      privateRecoveryWritten: false,
      sourceCheckpointImported: false,
      productionModified: false,
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
  const args = process.argv.slice(2);

  if (args.length !== 1) {
    throw new Error('B2_8_FLAG_REQUIRED');
  }

  if (args[0] === '--preflight') {
    await preflight();
  } else if (args[0] === '--execute') {
    await exercise();
  } else {
    throw new Error('B2_8_INVALID_FLAG');
  }
} catch {
  console.error('[B2.8.2] FAIL - detalhes sensiveis omitidos.');
  process.exitCode = 2;
}