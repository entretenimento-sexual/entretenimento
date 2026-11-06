#!/usr/bin/env node
// Issue #236 / B2.9.3a. TRANSACTION REHEARSAL ONLY on empty disposable emulators.
// No production writer, callable, recovery persistence, migration, export or deploy.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT = 'demo-entretenimento-legacy-governance';
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORTS = [28080, 29099, 29150, 29400, 29450];
const BANNED = [
  'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT',
  'CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'GOOGLE_CLOUD_QUOTA_PROJECT', 'FIREBASE_TOKEN',
  'GOOGLE_OAUTH_ACCESS_TOKEN', 'GOOGLE_CLOUD_ACCESS_TOKEN',
  'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST',
];
const abs = relative => path.join(ROOT, relative);
const WINDOW_MS = 15 * 60_000;
const REQUEST_KEYS = [
  'schemaVersion', 'operationId', 'purpose', 'projectId', 'targetCollection',
  'candidateCount', 'legacyEntryCount', 'requestedByUid', 'requestedAtMs',
  'approvedByUid', 'approvedAtMs', 'expiresAtMs', 'revokedAtMs',
  'consumedAtMs', 'expiredAtMs', 'status', 'revision',
];

function noRemoteCredentials() {
  for (const key of BANNED) {
    assert.equal(Object.hasOwn(process.env, key), false, 'B293A_REMOTE_CREDENTIAL');
  }
}
function verifyLocalFiles() {
  assert.equal(realpathSync(process.cwd()).toLowerCase(),
    realpathSync(ROOT).toLowerCase(), 'B293A_ROOT_MISMATCH');
  const index = readFileSync(abs('functions/src/index.ts'), 'utf8');
  const rules = readFileSync(abs('firestore.rules'), 'utf8');
  assert.equal(index.includes('inspectLegacyRecoveryReviewAuthorityReadOnly'), false);
  assert.equal(index.includes('inspectLegacyRecoveryAdminReadOnly'), false);
  for (const pattern of [
    'legacy_discovery_recovery_approvals/{operationId}',
    'legacy_discovery_preference_recovery/{ownerUid}',
  ]) assert.ok(rules.includes(`match /${pattern}`), 'B293A_RULES_MISSING');
  assert.ok(statSync(abs('functions/node_modules/firebase-admin')).isDirectory());
  const config = JSON.parse(readFileSync(abs('firebase.legacy-governance-e2e.json'), 'utf8'));
  assert.deepEqual(config.emulators.auth, { host: '127.0.0.1', port: 29099 });
  assert.equal(config.emulators.firestore.host, '127.0.0.1');
  assert.equal(config.emulators.firestore.port, 28080);
  assert.equal(config.emulators.singleProjectMode, true);
}
function portAvailable(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true },
      () => server.close(() => resolve(true)));
  });
}
async function preflight() {
  noRemoteCredentials();
  for (const key of [
    'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT', 'FUNCTIONS_EMULATOR', 'FIREBASE_CONFIG',
    'FIREBASE_PROJECT_ID',
  ]) assert.equal(Object.hasOwn(process.env, key), false, 'B293A_INHERITED_RUNTIME');
  verifyLocalFiles();
  for (const port of PORTS) assert.ok(await portAvailable(port), 'B293A_PORT_BUSY');
  console.log('B2.9.3a PREFLIGHT PASS - nenhum emulador iniciado');
}
function isolatedRuntime() {
  noRemoteCredentials();
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:28080');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:29099');
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
  assert.equal(process.env.FUNCTIONS_EMULATOR, 'true');
  if (process.env.FIREBASE_PROJECT_ID) {
    assert.equal(process.env.FIREBASE_PROJECT_ID, PROJECT);
  }
  if (process.env.FIREBASE_CONFIG) {
    assert.equal(JSON.parse(process.env.FIREBASE_CONFIG).projectId, PROJECT);
  }
  verifyLocalFiles();
}
function isActiveAdmin(data, capability) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const forbidden = [
    'deletionRequestedAt', 'deletedAt', 'purgeAfter', 'purgeStartedAt',
    'purgeLeaseOwner', 'purgeLeaseUntil', 'adminPrivilegeRevokedAt',
  ];
  return data.role === 'admin' && data.accountStatus === 'active' &&
    data[capability] === true && data.suspended !== true &&
    data.interactionBlocked !== true && data.accountLocked !== true &&
    data.loginAllowed !== false && data.legalHold !== true &&
    data.billingHold !== true && forbidden.every(k => data[k] == null);
}
function validApproval(v, operationId, operatorUid, reviewerUid, now, expectedRevision) {
  if (!v || typeof v !== 'object' || Array.isArray(v) ||
      Object.keys(v).length !== REQUEST_KEYS.length ||
      !REQUEST_KEYS.every(k => Object.hasOwn(v, k))) return false;
  const validTime = value => Number.isSafeInteger(value) &&
    value >= 1_700_000_000_000 && value <= 4_000_000_000_000;
  return v.schemaVersion === 1 && v.revision === expectedRevision &&
    expectedRevision === 1 && v.status === 'APPROVED_FOR_REVIEW_ONLY' &&
    v.operationId === operationId &&
    v.purpose === 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW' &&
    v.projectId === 'entretenimento-sexual' &&
    v.targetCollection === 'legacy_discovery_preference_recovery' &&
    v.candidateCount === 2 && v.legacyEntryCount === 8 &&
    v.requestedByUid === operatorUid && v.approvedByUid === reviewerUid &&
    operatorUid !== reviewerUid &&
    validTime(v.requestedAtMs) && validTime(v.approvedAtMs) &&
    validTime(v.expiresAtMs) &&
    v.requestedAtMs <= v.approvedAtMs &&
    v.approvedAtMs < v.requestedAtMs + WINDOW_MS &&
    v.expiresAtMs - v.approvedAtMs === WINDOW_MS &&
    v.approvedAtMs <= now && now < v.expiresAtMs &&
    v.revokedAtMs === null && v.consumedAtMs === null &&
    v.expiredAtMs === null;
}

async function exercise() {
  // The first SDK import can only happen AFTER verifying disposable runtime.
  isolatedRuntime();
  const requireFunctions = createRequire(abs('functions/package.json'));
  const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app');
  const { getAuth } = requireFunctions('firebase-admin/auth');
  const { getFirestore } = requireFunctions('firebase-admin/firestore');
  const app = initializeApp({ projectId: PROJECT }, 'b293a-isolated');
  const auth = getAuth(app);
  const db = getFirestore(app);
  try {
    assert.equal((await db.listCollections()).length, 0, 'B293A_DB_NOT_EMPTY');
    assert.equal((await auth.listUsers(1)).users.length, 0, 'B293A_AUTH_NOT_EMPTY');

    const operator = await auth.createUser({
      email: 'synthetic-b293a-operator@example.test', emailVerified: true,
    });
    const reviewer = await auth.createUser({
      email: 'synthetic-b293a-reviewer@example.test', emailVerified: true,
    });
    const operatorDoc = db.collection('users').doc(operator.uid);
    const reviewerDoc = db.collection('users').doc(reviewer.uid);
    const ledger = db.collection('legacy_discovery_recovery_approvals');
    await operatorDoc.set({
      role: 'admin', accountStatus: 'active', privateRecoveryOperator: true,
    });
    await reviewerDoc.set({
      role: 'admin', accountStatus: 'active', privateRecoveryReviewer: true,
    });
    const now = Date.now();
    const approvedAtMs = now - 60_000;
    const base = {
      schemaVersion: 1,
      purpose: 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW',
      projectId: 'entretenimento-sexual',
      targetCollection: 'legacy_discovery_preference_recovery',
      candidateCount: 2, legacyEntryCount: 8,
      requestedByUid: operator.uid, requestedAtMs: now - 120_000,
      approvedByUid: reviewer.uid, approvedAtMs,
      expiresAtMs: approvedAtMs + WINDOW_MS,
      revokedAtMs: null, consumedAtMs: null, expiredAtMs: null,
      status: 'APPROVED_FOR_REVIEW_ONLY', revision: 1,
    };
    const make = async (suffix, patch = {}) => {
      const operationId = `synthetic-b293a-${suffix}-operation`;
      const ref = ledger.doc(operationId);
      await ref.create({ ...base, operationId, ...patch });
      return { ref, operationId };
    };

    // This is test-only code, not a callable, export or backend function.
    // Every write is limited to a single synthetic approval document.
    async function consumeForReviewOnly(ref, operationId, expectedRevision = 1,
      injectRollback = false) {
      return db.runTransaction(async transaction => {
        const [approval, operatorState, reviewerState] = await Promise.all([
          transaction.get(ref), transaction.get(operatorDoc),
          transaction.get(reviewerDoc),
        ]);
        const current = Date.now();
        if (!approval.exists ||
            !isActiveAdmin(operatorState.data(), 'privateRecoveryOperator') ||
            !isActiveAdmin(reviewerState.data(), 'privateRecoveryReviewer') ||
            !validApproval(approval.data(), operationId, operator.uid,
              reviewer.uid, current, expectedRevision)) return false;
        // A short delay increases the likelihood of a write conflict in
        // the emulator. It is NOT a correctness mechanism.
        await new Promise(resolve => setTimeout(resolve, 20));
        transaction.update(ref, {
          status: 'CONSUMED_FOR_REVIEW_ONLY', consumedAtMs: current,
          revision: 2,
        });
        if (injectRollback) throw new Error('B293A_SYNTHETIC_ROLLBACK');
        return true;
      }, { maxAttempts: 5 });
    }

    const checks = {};
    const race = await make('race');
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => consumeForReviewOnly(race.ref, race.operationId))
    );
    const winners = results.filter(x => x.status === 'fulfilled' && x.value === true);
    const other = results.filter(x => x.status === 'rejected');
    // A Firestore ABORTED after bounded retries is acceptable contention.
    for (const item of other) {
      const code = String(item.reason?.code ?? '').toLowerCase();
      assert.ok(code === 'aborted' || code === '10', 'B293A_UNEXPECTED_TRANSACTION_ERROR');
    }
    assert.equal(winners.length, 1, 'B293A_MULTIPLE_WINNERS_OR_NO_WINNER');
    assert.equal((await race.ref.get()).data().status, 'CONSUMED_FOR_REVIEW_ONLY');
    assert.equal((await race.ref.get()).data().revision, 2);
    checks.concurrentSingleWinner = true;

    assert.equal(await consumeForReviewOnly(race.ref, race.operationId), false);
    checks.replayDenied = true;

    const stale = await make('stale');
    const staleBefore = (await stale.ref.get()).data();
    assert.equal(await consumeForReviewOnly(stale.ref, stale.operationId, 0), false);
    assert.deepEqual((await stale.ref.get()).data(), staleBefore);
    checks.staleRevisionDenied = true;

    const rollback = await make('rollback');
    const beforeRollback = (await rollback.ref.get()).data();
    await assert.rejects(consumeForReviewOnly(rollback.ref,
      rollback.operationId, 1, true), /B293A_SYNTHETIC_ROLLBACK/);
    assert.deepEqual((await rollback.ref.get()).data(), beforeRollback);
    assert.equal(await consumeForReviewOnly(rollback.ref, rollback.operationId), true);
    checks.transactionRollbackAtomic = true;

    const revoked = await make('revoked', { status: 'REVOKED',
      revokedAtMs: Date.now(), revision: 2 });
    assert.equal(await consumeForReviewOnly(revoked.ref, revoked.operationId), false);
    checks.revokedDenied = true;

    const expired = await make('expired', {
      approvedAtMs: now - WINDOW_MS - 60_000,
      expiresAtMs: now - 60_000,
      requestedAtMs: now - WINDOW_MS - 120_000,
    });
    assert.equal(await consumeForReviewOnly(expired.ref, expired.operationId), false);
    checks.expiredDenied = true;

    const scope = await make('scope', { targetCollection: 'public_profiles' });
    assert.equal(await consumeForReviewOnly(scope.ref, scope.operationId), false);
    checks.scopeTamperingDenied = true;

    const extra = await make('extra', { unexpectedPrivateField: 'synthetic' });
    assert.equal(await consumeForReviewOnly(extra.ref, extra.operationId), false);
    checks.extraFieldDenied = true;

    const self = await make('self', { approvedByUid: operator.uid });
    assert.equal(await consumeForReviewOnly(self.ref, self.operationId), false);
    checks.selfApprovalDenied = true;

    const operatorRevoked = await make('operator-revoked');
    await operatorDoc.update({ privateRecoveryOperator: false });
    assert.equal(await consumeForReviewOnly(operatorRevoked.ref,
      operatorRevoked.operationId), false);
    await operatorDoc.update({ privateRecoveryOperator: true });
    checks.operatorPrivilegeDenied = true;

    const reviewerRevoked = await make('reviewer-revoked');
    await reviewerDoc.update({ privateRecoveryReviewer: false });
    assert.equal(await consumeForReviewOnly(reviewerRevoked.ref,
      reviewerRevoked.operationId), false);
    await reviewerDoc.update({ privateRecoveryReviewer: true });
    checks.reviewerPrivilegeDenied = true;

    const names = (await db.listCollections()).map(x => x.id).sort();
    assert.deepEqual(names, ['legacy_discovery_recovery_approvals', 'users'],
      'B293A_UNEXPECTED_COLLECTION');
    checks.noPrivateRecoveryCollection = true;

    assert.equal(Object.keys(checks).length, 12, 'B293A_COVERAGE_MISSING');
    assert.ok(Object.values(checks).every(x => x === true));
    console.log(JSON.stringify({
      phase: 'B2_9_3A_SYNTHETIC_TRANSACTION_E2E', result: 'PASS',
      project: PROJECT, checks: Object.keys(checks).length, ...checks,
      decision: 'BLOCKED', persistentWritesAllowed: false,
      approvalWriterIntegrated: false, privateRecoveryRead: false,
      privateRecoveryWritten: false, sourceCheckpointImported: false,
      productionModified: false, primaryEmulatorModified: false,
    }));
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

try {
  if (process.argv.length !== 3) throw new Error('B293A_FLAG_REQUIRED');
  if (process.argv[2] === '--preflight') await preflight();
  else if (process.argv[2] === '--execute') await exercise();
  else throw new Error('B293A_UNKNOWN_FLAG');
} catch {
  console.error('[B2.9.3a] FAIL - detalhes sensiveis omitidos.');
  process.exitCode = 2;
}
