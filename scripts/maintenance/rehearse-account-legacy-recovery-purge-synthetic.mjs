#!/usr/bin/env node
// Issue #236 — B2.4: disposable, EMPTY Firestore Emulator with synthetic UIDs.
// No snapshot import, production connection, Cloud Functions invocation, deploy,
// account-scheduler invocation, export-on-exit or user-data write.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  SYNTHETIC_PURGE_PROJECT, SYNTHETIC_PURGE_HOST,
  SYNTHETIC_PURGE_PORT, SYNTHETIC_PURGE_WEBSOCKET_PORT,
  assertSyntheticPurgeInvocation, assertSyntheticEmulatorReport,
} from './account-legacy-recovery-purge-emulator.policy.mjs';
import {
  exerciseSyntheticOwnerFenceRaces,
} from './discovery-legacy-owner-fence-race.exercise.mjs';

const root = process.cwd();
const jar = path.join(os.homedir(), '.cache', 'firebase', 'emulators',
  'cloud-firestore-emulator-v1.22.0.jar');
const rules = path.join(root, 'firestore.rules');
const appModule = path.join(root, 'functions', 'lib', 'firebaseApp.js');
const adapterModule = path.join(root, 'functions', 'lib',
  'account_lifecycle', 'account-data-deletion.firestore.js');
const compiledPolicy = path.join(root, 'functions', 'lib',
  'account_lifecycle', 'account-legacy-recovery-purge.policy.js');
const javaFromHome = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin',
    process.platform === 'win32' ? 'java.exe' : 'java')
  : null;
const java = javaFromHome && fs.existsSync(javaFromHome)
  ? javaFromHome
  : process.platform === 'win32'
    ? 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot\\bin\\java.exe'
    : 'java';

function requireLocalFiles() {
  for (const filename of [
    jar, rules, appModule, adapterModule, compiledPolicy,
    path.join(root, 'functions', 'node_modules', 'firebase-admin'),
  ]) {
    const stat = fs.lstatSync(filename);
    if (stat.isSymbolicLink()) throw new Error('UNSAFE_LOCAL_DEPENDENCY');
  }
  if (process.platform === 'win32' && !fs.existsSync(java)) {
    throw new Error('LOCAL_JAVA_NOT_FOUND');
  }
  const builtRules = fs.readFileSync(rules, 'utf8');
  if (!builtRules.includes('match /legacy_discovery_preference_recovery/{ownerUid}') ||
      !builtRules.includes('allow read, write: if false;')) {
    throw new Error('RECOVERY_RULES_NOT_COMPILED');
  }
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () =>
      server.close(() => resolve(true)));
  });
}
function portReady(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (yes) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(yes);
    };
    socket.setTimeout(900);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}
async function waitForChild(getExited, getFailed) {
  for (let i = 0; i < 120; i += 1) {
    if (getExited() || getFailed()) throw new Error('SYNTHETIC_CHILD_FAILED');
    if (await portReady(SYNTHETIC_PURGE_PORT)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('SYNTHETIC_CHILD_NOT_READY');
}
async function stopChild(child, getExited) {
  if (!child.pid || getExited()) return;
  const done = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([done,
    new Promise((resolve) => setTimeout(resolve, 6000))]);
  if (!getExited()) {
    child.kill('SIGKILL');
    await Promise.race([done,
      new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
  if (!getExited()) throw new Error('SYNTHETIC_CHILD_STILL_RUNNING');
}
function must(condition, code) {
  if (!condition) throw new Error(code);
}
async function documentTreeAbsent(ref) {
  if ((await ref.get()).exists) return false;
  return (await ref.listCollections()).length === 0;
}
async function expectBlocked(action, code) {
  try {
    await action();
    throw new Error('EXPECTED_PURGE_REJECTION_MISSING');
  } catch (error) {
    if (error?.code !== code) throw new Error('UNEXPECTED_PURGE_REJECTION');
  }
}
function onlySyntheticDomainAdapter(realAdapter) {
  const zeroRoom = async () => ({
    scanned: 0, processed: 0, blockingOwners: 0,
  });
  const roomCalls = new Set([
    'unlinkRoomParticipationsPage', 'unlinkRoomMembershipsPage',
    'deleteRoomParticipantDocumentsPage', 'resolveOwnedRoomReferencesPage',
  ]);
  return new Proxy({
    deletePreferences: (uid) => realAdapter.deletePreferences(uid),
  }, {
    get(target, key) {
      if (Object.hasOwn(target, key)) return target[key];
      if (key === 'inspectBlockReferences') {
        return async () => ({ owned: 0, inbound: 0 });
      }
      return roomCalls.has(key) ? zeroRoom : async () => 0;
    },
  });
}
async function exercise(db, realAdapter, executor, retention) {
  const existing = await db.listCollections();
  must(existing.length === 0, 'SYNTHETIC_DATABASE_NOT_EMPTY');
  const now = Date.now();
  const owner = 'synthetic-success-owner';
  const orphan = 'synthetic-orphan-owner';
  const mismatch = 'synthetic-mismatch-owner';
  const expired = 'synthetic-expired-lease-owner';
  const active = 'synthetic-active-owner';
  const bystander = 'synthetic-bystander-owner';
  const recovery = (uid) =>
    db.collection('legacy_discovery_preference_recovery').doc(uid);
  const user = (uid) => db.collection('users').doc(uid);
  const preferences = (uid) => db.collection('preferences').doc(uid);
  const validDeletion = {
    accountStatus: 'deleted',
    purgeLeaseOwner: 'synthetic-lease',
    purgeLeaseUntil: now + 600_000,
  };
  const syntheticRecovery = (uid) => ({
    ownerUid: uid, schemaVersion: 1,
    lifecycle: 'PENDING_REVIEW',
    visibilityConsentConfirmed: false,
    legacyRaw: { interestedInGenders: ['synthetic-only'] },
  });

  for (const uid of [owner, orphan, mismatch, expired]) {
    await user(uid).set(validDeletion);
  }
  await user(expired).update({ purgeLeaseUntil: now - 1_000 });
  await user(active).set({ ...validDeletion, accountStatus: 'active' });
  await user(bystander).set({ accountStatus: 'active' });

  await recovery(owner).set(syntheticRecovery(owner));
  const child = recovery(owner).collection('synthetic_children').doc('first');
  const grandchild = child.collection('synthetic_grandchildren').doc('second');
  await child.set({ onlySynthetic: true });
  await grandchild.set({ onlySynthetic: true });
  await preferences(owner).set({ syntheticPreference: 'stay-until-purge' });
  await db.collection('community_notification_preferences')
    .doc(owner).collection('settings').doc('synthetic').set({ enabled: true });
  await db.collection('public_profiles').doc(owner)
    .set({ syntheticPublicProfile: true });

  await recovery(orphan).collection('synthetic_children')
    .doc('orphan').set({ onlySynthetic: true });
  must(!(await recovery(orphan).get()).exists,
    'ORPHAN_PRECONDITION_FAILED');

  await recovery(mismatch).set(syntheticRecovery('another-synthetic-owner'));
  await preferences(mismatch).set({ syntheticPreference: 'must-not-remove' });
  await recovery(expired).set(syntheticRecovery(expired));
  await recovery(active).set(syntheticRecovery(active));

  await recovery(bystander).set(syntheticRecovery(bystander));
  await recovery(bystander).collection('synthetic_children')
    .doc('bystander').set({ untouched: true });

  const removed = await realAdapter.deletePreferences(owner);
  must(removed === 2, 'SUCCESS_PURGE_COUNT_MISMATCH');
  must(await documentTreeAbsent(recovery(owner)),
    'SUCCESS_RECOVERY_SUBCOLLECTION_REMAINED');
  must(!(await preferences(owner).get()).exists,
    'SUCCESS_ACTIVE_PREFERENCES_REMAINED');
  must((await db.collection('community_notification_preferences').doc(owner)
    .listCollections()).length === 0,
  'SUCCESS_NOTIFICATION_PREFERENCES_REMAINED');
  must((await db.collection('public_profiles').doc(owner).get()).exists,
    'SUCCESS_PUBLIC_PROFILE_MODIFIED');
  must((await user(owner).get()).exists, 'SUCCESS_USER_DELETED');

  const idempotent = await realAdapter.deletePreferences(owner);
  must(idempotent === 0, 'SECOND_PURGE_WAS_NOT_IDEMPOTENT');

  const orphanRemoved = await realAdapter.deletePreferences(orphan);
  must(orphanRemoved === 0 &&
    await documentTreeAbsent(recovery(orphan)),
  'ORPHAN_SUBCOLLECTION_NOT_REMOVED');

  await expectBlocked(
    () => realAdapter.deletePreferences(mismatch),
    'purge/legacy-recovery-owner-mismatch'
  );
  must((await recovery(mismatch).get()).exists &&
    (await preferences(mismatch).get()).exists,
  'MISMATCH_PURGE_MODIFIED_DATA');

  await expectBlocked(
    () => realAdapter.deletePreferences(expired),
    'purge/legacy-recovery-deletion-lease-required'
  );
  must((await recovery(expired).get()).exists,
    'EXPIRED_LEASE_PURGE_MODIFIED_DATA');

  await expectBlocked(
    () => realAdapter.deletePreferences(active),
    'purge/legacy-recovery-deletion-lease-required'
  );
  must((await recovery(active).get()).exists,
    'ACTIVE_ACCOUNT_PURGE_MODIFIED_DATA');

  const summary = await executor.executeAccountDataDeletionDomains(
    onlySyntheticDomainAdapter(realAdapter), {
      uid: mismatch, generatedAt: now, pageSize: 10, maxPagesPerDomain: 1,
    }
  );
  const preference = summary.results.find((x) => x.domain === 'preferences');
  must(preference?.status === 'failed' &&
    !summary.completedDomains.includes('preferences'),
  'DOMAIN_FAILURE_NOT_PROPAGATED');

  const hypotheticalOtherDomainsCompleted = retention.ACCOUNT_DATA_RETENTION_POLICY
    .filter((x) => x.phase === 'pre_finalize' &&
      x.blocksFinalization && x.domain !== 'preferences')
    .map((x) => x.domain);
  const plan = retention.buildAccountDataDeletionPlan({
    uid: mismatch, generatedAt: now,
    completedDomains: [
      ...new Set([...hypotheticalOtherDomainsCompleted,
        ...summary.completedDomains.filter((x) => x !== 'preferences')]),
    ],
  });
  must(plan.blockingDomains.includes('preferences') &&
    !retention.canFinalizePrivateUserDeletion(plan),
  'ACCOUNT_FINALIZATION_NOT_BLOCKED');

  const bystanderRoot = await recovery(bystander).get();
  const bystanderChild = await recovery(bystander)
    .collection('synthetic_children').doc('bystander').get();
  must(bystanderRoot.exists && bystanderChild.exists,
    'UNRELATED_OWNER_MODIFIED');

  // B2.5: same transaction reads the owner status and stages a synthetic
  // recovery. A concurrent deletion intent must invalidate that read.
  const race = await exerciseSyntheticOwnerFenceRaces(db, realAdapter);

  return assertSyntheticEmulatorReport({
    mode: 'SYNTHETIC_FIRESTORE_PURGE_E2E',
    project: SYNTHETIC_PURGE_PROJECT,
    host: SYNTHETIC_PURGE_HOST,
    originalCheckpointImported: false,
    productionModified: false,
    primaryEmulatorModified: false,
    successRecoveryDocumentsDeleted: 1,
    successDescendantsDeleted: 2,
    idempotentRepeatRemoved: idempotent,
    orphanDescendantCleared: true,
    otherOwnerPreserved: true,
    mismatchedOwnerRejected: true,
    expiredLeaseRejected: true,
    activeAccountRejected: true,
    preferencesDomainFailedOnConflict: true,
    accountFinalizationBlocked: true,
    staleWriteAfterDeletionRejected: race.staleWriteAfterDeletionRejected,
    writerBeforeDeletionPurged: race.writerBeforeDeletionPurged,
    recreationAfterPurgeRejected: race.recreationAfterPurgeRejected,
    raceOwners: race.raceOwners,
    concurrentWritePurgedOrDenied: race.concurrentWritePurgedOrDenied,
    privateRecoveryWriterEnabled: false,
  });
}

async function main() {
  // Validate ALL environment and prerequisite guards before starting Java.
  assertSyntheticPurgeInvocation(process.env, process.argv.slice(2));
  requireLocalFiles();
  if (!(await portIsFree(SYNTHETIC_PURGE_PORT)) ||
      !(await portIsFree(SYNTHETIC_PURGE_WEBSOCKET_PORT))) {
    throw new Error('SYNTHETIC_PORTS_BUSY');
  }

  const child = spawn(java, [
    '-Duser.language=en', '-Duser.country=US',
    '-jar', jar,
    '--host', '127.0.0.1', '--port', String(SYNTHETIC_PURGE_PORT),
    '--websocket_port', String(SYNTHETIC_PURGE_WEBSOCKET_PORT),
    '--database-edition', 'standard',
    '--project_id', SYNTHETIC_PURGE_PROJECT,
    '--rules', rules, '--single_project_mode', 'true',
    // Deliberately NO --seed_from_export and NO export-on-exit.
  ], {
    cwd: root, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let exited = false;
  let spawnFailed = false;
  child.once('exit', () => { exited = true; });
  child.once('error', () => { spawnFailed = true; });
  child.stdout?.resume();
  child.stderr?.resume();

  const originalEnv = {
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    GCLOUD_PROJECT: process.env.GCLOUD_PROJECT,
    FIREBASE_CONFIG: process.env.FIREBASE_CONFIG,
  };
  let db;
  let app;
  let deleteApp;
  let report;
  try {
    await waitForChild(() => exited, () => spawnFailed);
    process.env.FIRESTORE_EMULATOR_HOST = SYNTHETIC_PURGE_HOST;
    process.env.GCLOUD_PROJECT = SYNTHETIC_PURGE_PROJECT;
    process.env.FIREBASE_CONFIG =
      JSON.stringify({ projectId: SYNTHETIC_PURGE_PROJECT });

    const requireFunctions = createRequire(
      path.join(root, 'functions', 'package.json')
    );
    const firebase = requireFunctions('./lib/firebaseApp.js');
    const { FirestoreAccountDataDeletionAdapter } =
      requireFunctions('./lib/account_lifecycle/account-data-deletion.firestore.js');
    const executor = requireFunctions(
      './lib/account_lifecycle/account-data-deletion.executor.js'
    );
    const retention = requireFunctions(
      './lib/account_lifecycle/account-data-retention.policy.js'
    );
    deleteApp = requireFunctions('firebase-admin/app').deleteApp;
    db = firebase.db;
    app = firebase.adminApp;
    must(app.options.projectId === SYNTHETIC_PURGE_PROJECT,
      'WRONG_EMULATOR_PROJECT');
    report = await exercise(
      db, new FirestoreAccountDataDeletionAdapter(), executor, retention
    );
  } finally {
    if (db) {
      try { await db.terminate(); } catch { /* no sensitive logs */ }
    }
    if (app && deleteApp) {
      try { await deleteApp(app); } catch { /* no sensitive logs */ }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await stopChild(child, () => exited);
  }
  // Nothing is exported, no data or per-owner hashes are logged.
  console.log(JSON.stringify(report, null, 2));
}

main().catch(() => {
  // Error details can include private paths. Do not forward any raw output.
  console.error('[recovery:discovery] Ensaio sintetico B2.4 nao concluido.');
  process.exitCode = 2;
});
