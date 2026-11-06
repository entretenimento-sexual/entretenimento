#!/usr/bin/env node
// Issue #236 / B2.9.3c. Atomic ledger + audit rehearsal on EMPTY disposable emulators ONLY.
// This runner is not a Cloud Function, writer, authorization API, migration or deployment.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendSyntheticReviewAuditEvent,
  verifySyntheticReviewAuditChain,
  REVIEW_AUDIT_KINDS,
} from './discovery-legacy-approval-audit-integrity.policy.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROJECT = 'demo-entretenimento-legacy-governance';
const PORTS = [28080, 29099, 29150, 29400, 29450];
const WINDOW = 15 * 60_000;
const BANNED = [
  'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT',
  'CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'GOOGLE_CLOUD_QUOTA_PROJECT', 'FIREBASE_TOKEN',
  'GOOGLE_OAUTH_ACCESS_TOKEN', 'GOOGLE_CLOUD_ACCESS_TOKEN',
  'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST',
];
const EVIDENCE_FIELDS = [
  'schemaVersion', 'operationId', 'purpose', 'projectId', 'targetCollection',
  'candidateCount', 'legacyEntryCount', 'requestedByUid', 'requestedAtMs',
  'approvedByUid', 'approvedAtMs', 'expiresAtMs', 'revokedAtMs',
  'consumedAtMs', 'expiredAtMs', 'status', 'revision',
];
const abs = name => path.join(ROOT, name);

function denyRemote() {
  for (const name of BANNED) {
    assert.equal(Object.hasOwn(process.env, name), false, 'B293C_REMOTE_CREDENTIAL');
  }
}
function verifyFiles() {
  assert.equal(realpathSync(process.cwd()).toLowerCase(),
    realpathSync(ROOT).toLowerCase(), 'B293C_ROOT_MISMATCH');
  const index = readFileSync(abs('functions/src/index.ts'), 'utf8');
  assert.equal(index.includes('consumeSyntheticReviewAndAuditAtomically'), false);
  const rules = readFileSync(abs('firestore.rules'), 'utf8');
  for (const collection of [
    'legacy_discovery_recovery_approvals/{operationId}',
    'legacy_discovery_preference_recovery/{ownerUid}',
  ]) assert.ok(rules.includes(`match /${collection}`), 'B293C_RULES_MISSING');
  const config = JSON.parse(readFileSync(abs('firebase.legacy-governance-e2e.json'), 'utf8'));
  assert.equal(config.emulators.singleProjectMode, true);
  assert.deepEqual(config.emulators.auth, {host:'127.0.0.1', port:29099});
  assert.equal(config.emulators.firestore.host, '127.0.0.1');
  assert.equal(config.emulators.firestore.port, 28080);
  assert.ok(statSync(abs('functions/node_modules/firebase-admin')).isDirectory());
}
function portFree(port) {
  return new Promise(resolve => {
    const socket = net.createServer();
    socket.once('error', () => resolve(false));
    socket.listen({host:'127.0.0.1', port, exclusive:true},
      () => socket.close(() => resolve(true)));
  });
}
async function preflight() {
  denyRemote();
  for (const name of [
    'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT', 'FUNCTIONS_EMULATOR', 'FIREBASE_CONFIG',
    'FIREBASE_PROJECT_ID',
  ]) assert.equal(Object.hasOwn(process.env, name), false, 'B293C_INHERITED_ENV');
  verifyFiles();
  for (const port of PORTS) assert.ok(await portFree(port), 'B293C_PORT_BUSY');
  console.log('B2.9.3c PREFLIGHT PASS - emuladores nao iniciados');
}
function isolatedRuntime() {
  denyRemote();
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
  verifyFiles();
}
function activeAdmin(doc, capability) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return false;
  const forbidden = [
    'deletionRequestedAt', 'deletedAt', 'purgeAfter', 'purgeStartedAt',
    'purgeLeaseOwner', 'purgeLeaseUntil', 'adminPrivilegeRevokedAt',
  ];
  return doc.role === 'admin' && doc.accountStatus === 'active' &&
    doc[capability] === true && doc.suspended !== true &&
    doc.interactionBlocked !== true && doc.accountLocked !== true &&
    doc.loginAllowed !== false && doc.legalHold !== true &&
    doc.billingHold !== true && forbidden.every(k => doc[k] == null);
}
function eligible(v, operationId, operatorUid, reviewerUid, now, revision) {
  if (!v || typeof v !== 'object' || Array.isArray(v) ||
      Object.keys(v).length !== EVIDENCE_FIELDS.length ||
      !EVIDENCE_FIELDS.every(k => Object.hasOwn(v, k))) return false;
  const tm = x => Number.isSafeInteger(x) && x >= 1_700_000_000_000 &&
    x <= 4_000_000_000_000;
  return v.schemaVersion === 1 && revision === 1 && v.revision === revision &&
    v.status === 'APPROVED_FOR_REVIEW_ONLY' &&
    v.operationId === operationId &&
    v.purpose === 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW' &&
    v.projectId === 'entretenimento-sexual' &&
    v.targetCollection === 'legacy_discovery_preference_recovery' &&
    v.candidateCount === 2 && v.legacyEntryCount === 8 &&
    v.requestedByUid === operatorUid && v.approvedByUid === reviewerUid &&
    operatorUid !== reviewerUid && tm(v.requestedAtMs) && tm(v.approvedAtMs) &&
    tm(v.expiresAtMs) && v.requestedAtMs <= v.approvedAtMs &&
    v.approvedAtMs < v.requestedAtMs + WINDOW &&
    v.expiresAtMs - v.approvedAtMs === WINDOW &&
    v.approvedAtMs <= now && now < v.expiresAtMs &&
    v.revokedAtMs === null && v.consumedAtMs === null &&
    v.expiredAtMs === null;
}

async function exercise() {
  // Prove isolated runtime BEFORE loading the Firebase Admin SDK.
  isolatedRuntime();
  const requireFn = createRequire(abs('functions/package.json'));
  const { initializeApp, deleteApp } = requireFn('firebase-admin/app');
  const { getAuth } = requireFn('firebase-admin/auth');
  const { getFirestore } = requireFn('firebase-admin/firestore');
  const app = initializeApp({projectId: PROJECT}, 'b293c-disposable');
  const auth = getAuth(app);
  const db = getFirestore(app);
  try {
    assert.equal((await db.listCollections()).length, 0, 'B293C_DB_NOT_EMPTY');
    assert.equal((await auth.listUsers(1)).users.length, 0, 'B293C_AUTH_NOT_EMPTY');
    const operator = await auth.createUser({
      email: 'synthetic-b293c-operator@example.test', emailVerified: true,
    });
    const reviewer = await auth.createUser({
      email: 'synthetic-b293c-reviewer@example.test', emailVerified: true,
    });
    const operatorDoc = db.collection('users').doc(operator.uid);
    const reviewerDoc = db.collection('users').doc(reviewer.uid);
    const ledger = db.collection('legacy_discovery_recovery_approvals');
    // This collection exists ONLY inside the new, empty, isolated emulator.
    const audit = db.collection('synthetic_legacy_review_audit_b293c');
    await operatorDoc.set({
      role:'admin', accountStatus:'active', privateRecoveryOperator:true,
    });
    await reviewerDoc.set({
      role:'admin', accountStatus:'active', privateRecoveryReviewer:true,
    });
    const start = Date.now();
    const approved = start - 60_000;
    const template = {
      schemaVersion:1, purpose:'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW',
      projectId:'entretenimento-sexual',
      targetCollection:'legacy_discovery_preference_recovery',
      candidateCount:2, legacyEntryCount:8, requestedByUid:operator.uid,
      requestedAtMs:start - 120_000, approvedByUid:reviewer.uid,
      approvedAtMs:approved, expiresAtMs:approved + WINDOW,
      revokedAtMs:null, consumedAtMs:null, expiredAtMs:null,
      status:'APPROVED_FOR_REVIEW_ONLY', revision:1,
    };
    async function make(suffix, patch = {}) {
      const operationId = `synthetic-b293c-${suffix}-operation`;
      const approvalRef = ledger.doc(operationId);
      const auditRef = audit.doc(`synthetic-b293c-${suffix}-audit`);
      await approvalRef.create({...template, operationId, ...patch});
      return {approvalRef, auditRef, operationId};
    }
    function auditEnvelope(now) {
      const entries = appendSyntheticReviewAuditEvent([], {
        kind:REVIEW_AUDIT_KINDS.CONSUMED_SYNTHETIC, atMs:now,
      });
      assert.ok(verifySyntheticReviewAuditChain(entries), 'B293C_BAD_AUDIT_CHAIN');
      return {schemaVersion:1, entries};
    }
    function validAuditDoc(value) {
      return value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === 2 && value.schemaVersion === 1 &&
        Array.isArray(value.entries) && value.entries.length === 1 &&
        verifySyntheticReviewAuditChain(value.entries) &&
        value.entries[0].kind === REVIEW_AUDIT_KINDS.CONSUMED_SYNTHETIC;
    }

    // B2.9.3c ONLY: never exported from this script or used in Cloud Functions.
    // Both writes share ONE Firestore transaction. No private collection access.
    async function consumeSyntheticReviewAndAuditAtomically(item,
      expectedRevision = 1, failAfterScheduledWrites = false) {
      return db.runTransaction(async tx => {
        const [approval, currentOperator, currentReviewer, auditExisting] =
          await Promise.all([
            tx.get(item.approvalRef), tx.get(operatorDoc),
            tx.get(reviewerDoc), tx.get(item.auditRef),
          ]);
        const now = Date.now();
        if (!approval.exists || auditExisting.exists ||
            !activeAdmin(currentOperator.data(), 'privateRecoveryOperator') ||
            !activeAdmin(currentReviewer.data(), 'privateRecoveryReviewer') ||
            !eligible(approval.data(), item.operationId, operator.uid,
              reviewer.uid, now, expectedRevision)) return false;
        const envelope = auditEnvelope(now);
        await new Promise(resolve => setTimeout(resolve, 20));
        tx.update(item.approvalRef, {
          status:'CONSUMED_FOR_REVIEW_ONLY', consumedAtMs:now, revision:2,
        });
        tx.create(item.auditRef, envelope);
        if (failAfterScheduledWrites) throw new Error('B293C_FORCED_ROLLBACK');
        return true;
      }, {maxAttempts:5});
    }
    const checks = {};
    async function remainsUnchanged(item, fn) {
      const before = (await item.approvalRef.get()).data();
      const outcome = await fn();
      assert.equal(outcome, false);
      assert.deepEqual((await item.approvalRef.get()).data(), before);
      assert.equal((await item.auditRef.get()).exists, false);
    }
    async function verifyPair(item) {
      const a = (await item.approvalRef.get()).data();
      const e = (await item.auditRef.get()).data();
      assert.equal(a.status, 'CONSUMED_FOR_REVIEW_ONLY');
      assert.equal(a.revision, 2);
      assert.equal(Number.isSafeInteger(a.consumedAtMs), true);
      assert.equal(validAuditDoc(e), true);
      assert.equal(e.entries[0].atMs, a.consumedAtMs);
    }

    const success = await make('success');
    assert.equal(await consumeSyntheticReviewAndAuditAtomically(success), true);
    await verifyPair(success);
    checks.atomicPairCommitted = true;

    const beforeReplay = (await success.auditRef.get()).data();
    assert.equal(await consumeSyntheticReviewAndAuditAtomically(success), false);
    await verifyPair(success);
    assert.deepEqual((await success.auditRef.get()).data(), beforeReplay);
    checks.replayDenied = true;

    const concurrency = await make('race');
    const results = await Promise.allSettled(Array.from({length:6}, () =>
      consumeSyntheticReviewAndAuditAtomically(concurrency)));
    const winners = results.filter(x => x.status === 'fulfilled' && x.value === true);
    for (const other of results.filter(x => x.status === 'rejected')) {
      const code = String(other.reason?.code ?? '').toLowerCase();
      assert.ok(code === 'aborted' || code === '10', 'B293C_UNEXPECTED_TX_FAILURE');
    }
    assert.equal(winners.length, 1, 'B293C_MULTIPLE_WINNERS');
    await verifyPair(concurrency);
    assert.equal((await audit.get()).size, 2);
    checks.concurrentSinglePair = true;

    const rollback = await make('rollback');
    const oldApproval = (await rollback.approvalRef.get()).data();
    await assert.rejects(consumeSyntheticReviewAndAuditAtomically(rollback, 1, true),
      /B293C_FORCED_ROLLBACK/);
    assert.deepEqual((await rollback.approvalRef.get()).data(), oldApproval);
    assert.equal((await rollback.auditRef.get()).exists, false);
    checks.rollbackBoth = true;

    const collision = await make('collision');
    await collision.auditRef.create(auditEnvelope(Date.now()));
    const beforeCollision = (await collision.approvalRef.get()).data();
    assert.equal(await consumeSyntheticReviewAndAuditAtomically(collision), false);
    assert.deepEqual((await collision.approvalRef.get()).data(), beforeCollision);
    assert.equal(validAuditDoc((await collision.auditRef.get()).data()), true);
    checks.preexistingAuditDenied = true;

    const stale = await make('stale');
    await remainsUnchanged(stale, () =>
      consumeSyntheticReviewAndAuditAtomically(stale, 0));
    checks.staleRevisionDenied = true;

    const expired = await make('expired', {
      requestedAtMs:start - WINDOW - 120_000,
      approvedAtMs:start - WINDOW - 60_000,
      expiresAtMs:start - 60_000,
    });
    await remainsUnchanged(expired, () => consumeSyntheticReviewAndAuditAtomically(expired));
    checks.expiredDenied = true;

    const revoked = await make('revoked', {status:'REVOKED',
      revokedAtMs:Date.now(), revision:2});
    await remainsUnchanged(revoked, () => consumeSyntheticReviewAndAuditAtomically(revoked));
    checks.revokedDenied = true;

    const scope = await make('scope', {targetCollection:'public_profiles'});
    await remainsUnchanged(scope, () => consumeSyntheticReviewAndAuditAtomically(scope));
    checks.scopeTamperingDenied = true;

    const extra = await make('extra', {legacyRaw:['synthetic-sentinel']});
    await remainsUnchanged(extra, () => consumeSyntheticReviewAndAuditAtomically(extra));
    checks.extraFieldDenied = true;

    const self = await make('self', {approvedByUid:operator.uid});
    await remainsUnchanged(self, () => consumeSyntheticReviewAndAuditAtomically(self));
    checks.selfApprovalDenied = true;

    const opRevoked = await make('operator-revoked');
    await operatorDoc.update({privateRecoveryOperator:false});
    await remainsUnchanged(opRevoked, () => consumeSyntheticReviewAndAuditAtomically(opRevoked));
    await operatorDoc.update({privateRecoveryOperator:true});
    checks.operatorPrivilegeDenied = true;

    const revRevoked = await make('reviewer-revoked');
    await reviewerDoc.update({privateRecoveryReviewer:false});
    await remainsUnchanged(revRevoked, () => consumeSyntheticReviewAndAuditAtomically(revRevoked));
    await reviewerDoc.update({privateRecoveryReviewer:true});
    checks.reviewerPrivilegeDenied = true;

    const tampered = await make('tampered');
    assert.equal(await consumeSyntheticReviewAndAuditAtomically(tampered), true);
    const oldEntry = (await tampered.auditRef.get()).data().entries[0];
    await tampered.auditRef.update({entries:[{...oldEntry, entryHash:'f'.repeat(64)}]});
    assert.equal(validAuditDoc((await tampered.auditRef.get()).data()), false);
    checks.auditTamperingDetected = true;

    const collections = (await db.listCollections()).map(x => x.id).sort();
    assert.deepEqual(collections, [
      'legacy_discovery_recovery_approvals',
      'synthetic_legacy_review_audit_b293c', 'users',
    ], 'B293C_UNEXPECTED_COLLECTIONS');
    checks.noPrivateRecoveryCollection = true;

    assert.equal(Object.keys(checks).length, 15, 'B293C_COVERAGE_MISSING');
    assert.ok(Object.values(checks).every(x => x === true));
    // Only aggregate values. No operation ID, UID, token, path, hash or payload.
    console.log(JSON.stringify({
      phase:'B2_9_3C_SYNTHETIC_ATOMIC_AUDIT_E2E', result:'PASS', project:PROJECT,
      checks:Object.keys(checks).length, ...checks,
      decision:'BLOCKED', persistentWritesAllowed:false,
      approvalWriterIntegrated:false, auditProductionPersisted:false,
      privateRecoveryRead:false, privateRecoveryWritten:false,
      sourceCheckpointImported:false, productionModified:false,
      primaryEmulatorModified:false,
    }));
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

try {
  if (process.argv.length !== 3) throw new Error('B293C_FLAG_REQUIRED');
  if (process.argv[2] === '--preflight') await preflight();
  else if (process.argv[2] === '--execute') await exercise();
  else throw new Error('B293C_INVALID_FLAG');
} catch {
  console.error('[B2.9.3c] FAIL - detalhes sensiveis omitidos.');
  process.exitCode = 2;
}
