#!/usr/bin/env node
// Issue #236 / B2.9.3e: seed and READ only disposable synthetic emulator fixtures.
// No production reads, private preferences, repair, migration, export, deployment or writer.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendSyntheticReviewAuditEvent,
  REVIEW_AUDIT_KINDS,
} from './discovery-legacy-approval-audit-integrity.policy.mjs';
import { reconcileSyntheticReviewApprovals } from './discovery-legacy-approval-reconciliation.policy.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROJECT = 'demo-entretenimento-legacy-governance';
const PORTS = Object.freeze([28080, 29099, 29150, 29400, 29450]);
const COLLECTIONS = Object.freeze({
  approvals: 'synthetic_b293e_approval_fixtures',
  audits: 'synthetic_b293e_audit_fixtures',
});
const BANNED = Object.freeze([
  'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCP_PROJECT',
  'CLOUDSDK_CORE_PROJECT', 'CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE',
  'GOOGLE_CLOUD_QUOTA_PROJECT', 'FIREBASE_TOKEN',
  'GOOGLE_OAUTH_ACCESS_TOKEN', 'GOOGLE_CLOUD_ACCESS_TOKEN',
  'FIREBASE_DATABASE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST',
]);
const APPROVAL_KEYS = Object.freeze([
  'syntheticKey', 'schemaVersion', 'status', 'revision',
  'purpose', 'projectId', 'targetCollection', 'candidateCount',
  'legacyEntryCount', 'requestedAtMs', 'approvedAtMs', 'expiresAtMs',
  'consumedAtMs', 'revokedAtMs', 'expiredAtMs',
]);
const AUDIT_KEYS = Object.freeze(['syntheticKey', 'schemaVersion', 'entries']);
const DOCUMENT_RE = /^synthetic-fixture-b293e-[a-z0-9-]{3,64}$/;
const KEY_RE = /^synthetic-b293d-[a-z0-9-]{3,64}$/;
const abs = relative => path.join(ROOT, relative);

function denyRemoteCredentials() {
  for (const name of BANNED) {
    assert.equal(Object.hasOwn(process.env, name), false, 'B293E_REMOTE_CREDENTIAL');
  }
}
function verifyLocalFiles() {
  assert.equal(realpathSync(process.cwd()).toLowerCase(),
    realpathSync(ROOT).toLowerCase(), 'B293E_WRONG_ROOT');
  const index = readFileSync(abs('functions/src/index.ts'), 'utf8');
  assert.equal(index.includes('reconcileSyntheticEmulatorReviewFixtures'), false,
    'B293E_PRODUCTION_ENTRYPOINT');
  assert.ok(statSync(abs('functions/node_modules/firebase-admin')).isDirectory(),
    'B293E_DEPENDENCIES_REQUIRED');
  const config = JSON.parse(readFileSync(abs('firebase.legacy-governance-e2e.json'), 'utf8'));
  assert.equal(config.emulators.singleProjectMode, true);
  assert.deepEqual(config.emulators.auth, { host: '127.0.0.1', port: 29099 });
  assert.equal(config.emulators.firestore.host, '127.0.0.1');
  assert.equal(config.emulators.firestore.port, 28080);
}
function portFree(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port, exclusive: true },
      () => server.close(() => resolve(true)));
  });
}
async function preflight() {
  denyRemoteCredentials();
  for (const key of [
    'FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST',
    'GCLOUD_PROJECT', 'FUNCTIONS_EMULATOR', 'FIREBASE_CONFIG',
    'FIREBASE_PROJECT_ID',
  ]) assert.equal(Object.hasOwn(process.env, key), false, 'B293E_INHERITED_RUNTIME');
  verifyLocalFiles();
  for (const port of PORTS) assert.ok(await portFree(port), 'B293E_PORT_BUSY');
  console.log('B2.9.3e PREFLIGHT PASS - emuladores nao iniciados');
}
function isolatedRuntime() {
  // Assert emulator hosts and demo project BEFORE requiring the Firebase SDK.
  denyRemoteCredentials();
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
function isPlain(x) {
  return x !== null && typeof x === 'object' && !Array.isArray(x) &&
    Object.getPrototypeOf(x) === Object.prototype;
}
function exactKeys(x, fields) {
  return isPlain(x) && Object.keys(x).length === fields.length &&
    fields.every(field => Object.hasOwn(x, field));
}
function safeProjection(snapshot, kind) {
  const fields = kind === 'approvals' ? APPROVAL_KEYS : AUDIT_KEYS;
  assert.ok(snapshot.size > 0 && snapshot.size <= 64, 'B293E_BAD_SNAPSHOT_SIZE');
  return snapshot.docs.map(doc => {
    assert.ok(DOCUMENT_RE.test(doc.id), 'B293E_UNTRUSTED_DOCUMENT_ID');
    const data = doc.data();
    assert.ok(exactKeys(data, fields) && KEY_RE.test(data.syntheticKey),
      'B293E_UNTRUSTED_PROJECTION');
    return Object.fromEntries(fields.map(field => [field, data[field]]));
  });
}

function syntheticFixtures(nowMs) {
  // Every projection is synthetic, anonymous, bounded and created by this runner.
  const T = nowMs - 60_000;
  const key = suffix => `synthetic-b293d-b293e-${suffix}`;
  const approval = (suffix, patch = {}) => ({
    syntheticKey: key(suffix), schemaVersion: 1,
    status: 'CONSUMED_FOR_REVIEW_ONLY', revision: 2,
    purpose: 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW',
    projectId: 'entretenimento-sexual',
    targetCollection: 'legacy_discovery_preference_recovery',
    candidateCount: 2, legacyEntryCount: 8,
    requestedAtMs: T - 120_000, approvedAtMs: T - 60_000,
    expiresAtMs: T + 840_000, consumedAtMs: T,
    revokedAtMs: null, expiredAtMs: null,
    ...patch,
  });
  const audit = (suffix, patch = {}) => ({
    syntheticKey: key(suffix), schemaVersion: 1,
    entries: appendSyntheticReviewAuditEvent([], {
      kind: REVIEW_AUDIT_KINDS.CONSUMED_SYNTHETIC, atMs: T,
    }),
    ...patch,
  });
  const corrupt = audit('hash');
  const approvals = [
    approval('happy'),
    approval('missing'),
    approval('pending', {
      status: 'APPROVED_FOR_REVIEW_ONLY', revision: 1, consumedAtMs: null,
    }),
    approval('stale', { revision: 1 }),
    approval('scope', { targetCollection: 'public_profiles' }),
    approval('hash'),
    approval('time', { consumedAtMs: T + 1 }),
    approval('dup-approval'),
    approval('dup-approval'),
    approval('dup-audit'),
    approval('timeline', { consumedAtMs: T - 70_000 }),
    approval('expired', {
      status: 'EXPIRED', revision: 2,
      consumedAtMs: null, expiredAtMs: T + 840_000,
    }),
  ];
  const audits = [
    audit('happy'), audit('orphan'), audit('pending'), audit('stale'),
    audit('scope'),
    { ...corrupt, entries: [{ ...corrupt.entries[0], entryHash: 'g'.repeat(64) }] },
    audit('time'), audit('dup-approval'),
    audit('dup-audit'), audit('dup-audit'), audit('timeline'), audit('expired'),
  ];
  return { approvals, audits };
}
function assertAggregateReport(report, fixtures, readAgain, before, after, checks) {
  assert.equal(report.approvalsInspected, 12);
  assert.equal(report.auditsInspected, 12);
  assert.equal(report.matchedSyntheticPairs, 1);
  checks.matchedReadPair = true;
  assert.equal(report.missingAudit, 1);
  checks.missingAuditDetected = true;
  assert.equal(report.orphanAudit, 1);
  checks.orphanAuditDetected = true;
  assert.equal(report.auditWithoutConsumption, 2);
  checks.nonconsumedAuditDetected = true;
  assert.equal(report.invalidRevision, 1);
  checks.staleRevisionDetected = true;
  assert.equal(report.invalidScope, 1);
  checks.invalidScopeDetected = true;
  assert.equal(report.invalidAudit, 1);
  checks.corruptAuditDetected = true;
  assert.equal(report.timestampMismatch, 2);
  checks.timestampMismatchDetected = true;
  assert.equal(report.invalidTimeline, 1);
  checks.invalidTimelineDetected = true;
  assert.equal(report.duplicateApprovalKeys, 1);
  checks.duplicateApprovalDetected = true;
  assert.equal(report.duplicateAuditKeys, 1);
  checks.duplicateAuditDetected = true;
  assert.equal(report.totalIssues, 12);
  assert.equal(report.shapeReconciled, false);
  checks.failClosedWithInconsistencies = true;
  assert.deepEqual(readAgain, fixtures);
  assert.deepEqual(before, after);
  checks.reconciliationDidNotMutate = true;
  for (const flag of [
    'sourceIsTrusted', 'externalAnchorVerified', 'backendIdentityVerified',
    'auditDurabilityVerified', 'automatedRepairAllowed',
    'approvalWriterIntegrated', 'auditProductionPersisted',
    'persistentWritesAllowed', 'privateRecoveryRead',
    'privateRecoveryWritten', 'sourceDeletionAllowed',
    'publicVisibilityAllowed',
  ]) assert.equal(report[flag], false, flag);
  assert.equal(report.decision, 'BLOCKED');
  checks.recoveryAndRepairBlocked = true;
  const serialized = JSON.stringify(report);
  for (const row of [...fixtures.approvals, ...fixtures.audits]) {
    assert.equal(serialized.includes(row.syntheticKey), false);
  }
  for (const forbidden of ['syntheticKey', 'operationId', 'uid',
    'entryHash', 'previousHash', 'token', 'atMs', 'jwt']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  checks.reportAggregateOnly = true;
}

async function exercise() {
  isolatedRuntime();
  const requireFn = createRequire(abs('functions/package.json'));
  const { initializeApp, deleteApp } = requireFn('firebase-admin/app');
  const { getFirestore } = requireFn('firebase-admin/firestore');
  const { getAuth } = requireFn('firebase-admin/auth');
  const app = initializeApp({ projectId: PROJECT }, 'b293e-disposable');
  const db = getFirestore(app);
  const auth = getAuth(app);
  try {
    assert.equal((await db.listCollections()).length, 0, 'B293E_DB_NOT_EMPTY');
    assert.equal((await auth.listUsers(1)).users.length, 0, 'B293E_AUTH_NOT_EMPTY');
    const checks = { emptyDisposableStores: true };
    const approvalsRef = db.collection(COLLECTIONS.approvals);
    const auditsRef = db.collection(COLLECTIONS.audits);
    const fixtures = syntheticFixtures(Date.now());
    assert.equal(fixtures.approvals.length, 12);
    assert.equal(fixtures.audits.length, 12);
    // Synthetic fixture seeding only: no transactions, repair, delete or production paths.
    for (const [kind, ref] of [['approvals', approvalsRef], ['audits', auditsRef]]) {
      for (let i = 0; i < fixtures[kind].length; i++) {
        const docId = `synthetic-fixture-b293e-${kind}-${String(i + 1).padStart(3, '0')}`;
        assert.ok(DOCUMENT_RE.test(docId));
        await ref.doc(docId).create(fixtures[kind][i]);
      }
    }
    checks.syntheticFixturesSeeded = true;
    // Firestore data are ACTUALLY queried, not synthesized from fixtures in memory.
    async function readSyntheticProjections() {
      const [approvalsSnapshot, auditsSnapshot] = await Promise.all([
        approvalsRef.get(), auditsRef.get(),
      ]);
      return {
        approvals: safeProjection(approvalsSnapshot, 'approvals'),
        audits: safeProjection(auditsSnapshot, 'audits'),
      };
    }
    const read = await readSyntheticProjections();
    assert.equal(read.approvals.length, 12);
    assert.equal(read.audits.length, 12);
    checks.realEmulatorCollectionsRead = true;
    const before = structuredClone(read);
    // No Firestore write is made while running the B2.9.3d pure reconciler.
    const report = reconcileSyntheticReviewApprovals({
      approvals: read.approvals,
      audits: read.audits,
      nowMs: Date.now(),
    });
    const after = await readSyntheticProjections();
    assertAggregateReport(report, fixtures, after, before, after, checks);
    const names = (await db.listCollections()).map(col => col.id).sort();
    assert.deepEqual(names, Object.values(COLLECTIONS).sort());
    checks.onlyDisposableCollections = true;
    assert.equal((await auth.listUsers(1)).users.length, 0);
    checks.authRemainedEmpty = true;
    assert.equal(Object.keys(checks).length, 20, 'B293E_COVERAGE_INCOMPLETE');
    assert.ok(Object.values(checks).every(v => v === true));
    console.log(JSON.stringify({
      phase: 'B2_9_3E_SYNTHETIC_FIRESTORE_RECONCILIATION_E2E',
      result: 'PASS', project: PROJECT, checks: 20,
      ...checks, decision: 'BLOCKED', persistentWritesAllowed: false,
      automatedRepairAllowed: false, privateRecoveryRead: false,
      privateRecoveryWritten: false, sourceCheckpointImported: false,
      productionModified: false, primaryEmulatorModified: false,
    }));
  } finally {
    await db.terminate();
    await deleteApp(app);
  }
}

try {
  if (process.argv.length !== 3) throw new Error('B293E_FLAG_REQUIRED');
  if (process.argv[2] === '--preflight') await preflight();
  else if (process.argv[2] === '--execute') await exercise();
  else throw new Error('B293E_UNRECOGNIZED_FLAG');
} catch {
  console.error('[B2.9.3e] FAIL - detalhes sensiveis omitidos.');
  process.exitCode = 2;
}
