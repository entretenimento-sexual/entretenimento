#!/usr/bin/env node
// Issue #236 — B2.1: transactional copy, verification and rollback ONLY inside
// an ephemeral Firestore Emulator import. Never use the primary emulator.
// All snapshots and candidate values remain in memory; output is aggregate.
// No write mode outside --isolated-rollback-test; no export-on-exit.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

import {
  PROJECT_ID, ISOLATED_FIRESTORE, EMULATOR_PORT, WEBSOCKET_PORT,
  TARGET_COLLECTION, MAX_PUBLIC_PROFILES, candidateFromPublicProfile,
  assessExistingRecovery,
} from './discovery-legacy-recovery-rehearsal.policy.mjs';
import {
  copyIntoIsolatedRecovery, rollbackIsolatedRecovery,
  verifyIsolationAfterRollback, verifyRecoveryCandidates,
} from './discovery-legacy-recovery-transaction.policy.mjs';
import {
  MAX_SNAPSHOT_DOCUMENTS, MAX_SNAPSHOT_COLLECTIONS,
  assertIsolatedRollbackInvocation, assertScannedPublicProfiles,
  assertExpectedIncident, digestDocumentFields,
  validateLogicalSnapshot, safeRollbackSummary,
} from './discovery-legacy-recovery-rollback-runner.policy.mjs';

const root = process.cwd();
const exportRoot = path.join(root, '.emulator-data');
const exportMeta = path.join(exportRoot, 'firebase-export-metadata.json');
const firestoreExport = path.join(exportRoot, 'firestore_export');
const seedMeta = path.join(
  firestoreExport, 'firestore_export.overall_export_metadata'
);
const jar = path.join(os.homedir(), '.cache', 'firebase', 'emulators',
  'cloud-firestore-emulator-v1.22.0.jar');
const rules = path.join(root, 'firestore.rules');
const adminDir = path.join(root, 'functions', 'node_modules', 'firebase-admin');
const javaFromHome = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin',
    process.platform === 'win32' ? 'java.exe' : 'java')
  : null;
const java = javaFromHome && fs.existsSync(javaFromHome)
  ? javaFromHome
  : process.platform === 'win32'
    ? 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot\\bin\\java.exe'
    : 'java';

function assertInputs() {
  for (const filename of [
    exportRoot, firestoreExport, exportMeta, seedMeta,
    jar, rules, adminDir,
  ]) {
    const info = fs.lstatSync(filename);
    if (info.isSymbolicLink()) throw new Error('SYMLINK_NOT_ALLOWED');
    if ([exportMeta, seedMeta].includes(filename) &&
        (!info.isFile() || info.size === 0)) {
      throw new Error('INVALID_EXPORT_METADATA');
    }
  }
  if (process.platform === 'win32' && !fs.existsSync(java)) {
    throw new Error('JAVA_NOT_AVAILABLE');
  }
  const compiled = fs.readFileSync(rules, 'utf8');
  if (!compiled.includes('// ===== legacy_discovery_preference_recovery.rules =====') ||
      !compiled.includes('match /legacy_discovery_preference_recovery/{ownerUid}') ||
      !compiled.includes('allow read, write: if false;')) {
    throw new Error('RECOVERY_RULES_NOT_BUILT');
  }
}

async function fingerprintExport() {
  // Check that the original Firestore export is byte-identical after rehearsal.
  // Only reads files. Never hashes Auth or Storage objects into user output.
  const filenames = [exportMeta];
  const scan = (dir) => {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const filename = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw new Error('EXPORT_SYMLINK');
      if (item.isDirectory()) scan(filename);
      else if (item.isFile()) filenames.push(filename);
      else throw new Error('UNEXPECTED_EXPORT_ENTRY');
      if (filenames.length > 1000) throw new Error('EXPORT_FILE_LIMIT');
    }
  };
  scan(firestoreExport);
  filenames.sort();
  const h = createHash('sha256');
  for (const filename of filenames) {
    const size = fs.statSync(filename).size;
    if (size > 512 * 1024 * 1024) throw new Error('EXPORT_FILE_TOO_LARGE');
    h.update(path.relative(exportRoot, filename));
    h.update(String(size));
    const file = createHash('sha256');
    for await (const part of fs.createReadStream(filename)) file.update(part);
    h.update(file.digest());
  }
  return h.digest('hex');
}

function portFree(port) {
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
    socket.setTimeout(800);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function waitForChild(getExited, getError) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (getExited() || getError()) throw new Error('CHILD_EMULATOR_FAILED');
    if (await portReady(EMULATOR_PORT)) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('CHILD_EMULATOR_NOT_READY');
}

async function stopChild(child, getExited) {
  if (!child?.pid || getExited()) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 6000)),
  ]);
  if (!getExited()) {
    child.kill('SIGKILL');
    await Promise.race([
      exited,
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  }
  if (!getExited()) throw new Error('ISOLATED_EMULATOR_STILL_RUNNING');
}

async function snapshotContent(db) {
  const values = new Map();
  const seen = new Set();
  const queue = await db.listCollections();
  while (queue.length) {
    const col = queue.shift();
    if (seen.has(col.path)) continue;
    seen.add(col.path);
    if (seen.size > MAX_SNAPSHOT_COLLECTIONS) {
      throw new Error('COLLECTION_COUNT_LIMIT');
    }
    const refs = await col.listDocuments();
    for (let i = 0; i < refs.length; i += 50) {
      const batch = refs.slice(i, i + 50);
      const docs = await db.getAll(...batch);
      for (const doc of docs) {
        if (doc.exists) {
          values.set(doc.ref.path, digestDocumentFields(doc.data()));
          if (values.size > MAX_SNAPSHOT_DOCUMENTS) {
            throw new Error('SNAPSHOT_DOCUMENT_LIMIT');
          }
        }
      }
      for (const ref of batch) queue.push(...await ref.listCollections());
      if (queue.length > MAX_SNAPSHOT_COLLECTIONS * 20) {
        throw new Error('COLLECTION_QUEUE_LIMIT');
      }
    }
  }
  return { values, collections: seen.size };
}

async function loadCandidates(db) {
  const records = await db.collection('public_profiles')
    .limit(MAX_PUBLIC_PROFILES + 1).get();
  assertScannedPublicProfiles(records.size);
  const candidates = [];
  let genders = 0;
  let orientations = 0;
  for (const doc of records.docs) {
    const candidate = candidateFromPublicProfile(doc.id, doc.data());
    if (!candidate) continue;
    const owner = await db.doc(`users/${doc.id}`).get();
    if (!owner.exists) throw new Error('SOURCE_OWNER_MISSING');
    candidates.push(candidate);
    genders += candidate.legacyRaw.interestedInGenders?.length ?? 0;
    orientations += candidate.legacyRaw.interestedInOrientations?.length ?? 0;
  }
  assertExpectedIncident(candidates.length, genders, orientations);
  verifyRecoveryCandidates(candidates);
  return { candidates, scanned: records.size, genders, orientations };
}

async function executeExercise(db) {
  const baseline = await snapshotContent(db);
  const { candidates, scanned, genders, orientations } =
    await loadCandidates(db);

  // Confirm state of the private quarantine BEFORE staging any writes.
  const recoveryRefs = candidates.map((c) =>
    db.doc(`${TARGET_COLLECTION}/${c.ownerUid}`));
  const previous = await db.getAll(...recoveryRefs);
  for (let i = 0; i < previous.length; i += 1) {
    if (previous[i].exists) {
      if (assessExistingRecovery(candidates[i], previous[i].data()) !==
          'ALREADY_PRESERVED') throw new Error('EXISTING_RECOVERY_CONFLICT');
    }
  }

  const first = await copyIntoIsolatedRecovery(db, candidates);
  let second;
  let deleted;
  try {
    const saved = await db.getAll(...recoveryRefs);
    for (let i = 0; i < saved.length; i += 1) {
      if (!saved[i].exists ||
          assessExistingRecovery(candidates[i], saved[i].data()) !==
          'ALREADY_PRESERVED') {
        throw new Error('POST_WRITE_INTEGRITY_FAILURE');
      }
    }
    second = await copyIntoIsolatedRecovery(db, candidates);
    if (second.createdCount !== 0 ||
        second.alreadyPreservedCount !== candidates.length) {
      throw new Error('TRANSACTION_NOT_IDEMPOTENT');
    }
  } finally {
    // No successful result if this fails. The child emulator is disposable,
    // but never delete a pre-existing or modified private record blindly.
    deleted = await rollbackIsolatedRecovery(
      db, candidates, first.createdOwnerUids);
    await verifyIsolationAfterRollback(
      db, candidates, first.createdOwnerUids);
  }

  const after = await snapshotContent(db);
  const same = validateLogicalSnapshot(baseline.values, after.values);
  if (baseline.collections !== after.collections) {
    throw new Error('COLLECTION_COUNT_MISMATCH');
  }

  return safeRollbackSummary({
    documentsVerified: same.documentsVerified,
    scanned, candidateCount: candidates.length, genders, orientations,
    first, second, deleted,
  });
}

async function main() {
  // Check flags and environment BEFORE launching Java or importing Admin SDK.
  assertIsolatedRollbackInvocation(process.env, process.argv.slice(2));
  assertInputs();
  if (!(await portFree(EMULATOR_PORT)) ||
      !(await portFree(WEBSOCKET_PORT))) {
    throw new Error('ISOLATED_PORTS_IN_USE');
  }
  const originalExportHash = await fingerprintExport();

  const child = spawn(java, [
    '-Duser.language=en', '-Duser.country=US',
    '-jar', jar,
    '--host', '127.0.0.1', '--port', String(EMULATOR_PORT),
    '--websocket_port', String(WEBSOCKET_PORT),
    '--database-edition', 'standard', '--project_id', PROJECT_ID,
    '--seed_from_export', seedMeta, '--rules', rules,
    '--single_project_mode', 'true',
  ], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let exited = false;
  let spawnError = false;
  child.once('exit', () => { exited = true; });
  child.once('error', () => { spawnError = true; });
  // Do not forward emulator internals (which could contain user identifiers).
  child.stdout?.resume();
  child.stderr?.resume();

  const previousHost = process.env.FIRESTORE_EMULATOR_HOST;
  let app;
  let db;
  let result;
  let deleteApp;
  try {
    await waitForChild(() => exited, () => spawnError);
    process.env.FIRESTORE_EMULATOR_HOST = ISOLATED_FIRESTORE;
    const requireFunctions = createRequire(
      path.join(root, 'functions', 'package.json')
    );
    const sdk = requireFunctions('firebase-admin/app');
    deleteApp = sdk.deleteApp;
    app = sdk.initializeApp({ projectId: PROJECT_ID },
      'legacy-recovery-rollback-isolated');
    db = requireFunctions('firebase-admin/firestore').getFirestore(app);
    result = await executeExercise(db);
  } finally {
    if (db) {
      try { await db.terminate(); } catch { /* generic CLI failure only */ }
    }
    if (app && deleteApp) {
      try { await deleteApp(app); } catch { /* generic CLI failure only */ }
    }
    if (previousHost === undefined) {
      delete process.env.FIRESTORE_EMULATOR_HOST;
    } else {
      process.env.FIRESTORE_EMULATOR_HOST = previousHost;
    }
    await stopChild(child, () => exited);
  }

  if (originalExportHash !== await fingerprintExport()) {
    throw new Error('ORIGINAL_EXPORT_CHANGED');
  }
  // Emit only aggregate counts, after both rollback and child termination.
  console.log(JSON.stringify(result, null, 2));
}

main().catch(() => {
  // No stack, UIDs, hashes, field values or paths in failure output.
  console.error('[recovery:discovery] Teste B2.1 isolado nao concluido. ' +
    'Nao execute a recuperacao persistente.');
  process.exitCode = 2;
});
