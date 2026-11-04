#!/usr/bin/env node
// Issue #236 — Fase B1: NO-WRITE rehearsal of private legacy recovery.
// Imports an exported snapshot in a dedicated child Firestore Emulator.
// It never writes to Firestore or to disk, never logs UIDs or private values,
// and never connects to the primary 8080 instance or production.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  PROJECT_ID, ISOLATED_FIRESTORE, EMULATOR_PORT, WEBSOCKET_PORT,
  MAX_PUBLIC_PROFILES, TARGET_COLLECTION, assertRehearsalOnly,
  assertSourceLimit, candidateFromPublicProfile, assessExistingRecovery,
  newAggregate, addCandidateToAggregate,
} from './discovery-legacy-recovery-rehearsal.policy.mjs';

const root = process.cwd();
const sourceDir = path.resolve(root, '.emulator-data');
const sourceMetadata = path.join(
  sourceDir, 'firestore_export', 'firestore_export.overall_export_metadata'
);
const topMetadata = path.join(sourceDir, 'firebase-export-metadata.json');
const jar = path.join(
  os.homedir(), '.cache', 'firebase', 'emulators',
  'cloud-firestore-emulator-v1.22.0.jar'
);
const javaFromHome = process.env.JAVA_HOME
  ? path.join(process.env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  : null;
const java = javaFromHome && fs.existsSync(javaFromHome)
  ? javaFromHome
  : process.platform === 'win32'
    ? 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot\\bin\\java.exe'
    : 'java';
const rules = path.join(root, 'firestore.rules');

function assertLocalFiles() {
  for (const filename of [
    sourceDir,
    path.join(sourceDir, 'firestore_export'),
    sourceMetadata, topMetadata,
    jar, rules,
    path.join(root, 'functions', 'node_modules', 'firebase-admin'),
  ]) {
    const state = fs.lstatSync(filename);
    if (state.isSymbolicLink()) throw new Error('UNSAFE_SNAPSHOT_PATH');
    if (filename === sourceMetadata || filename === topMetadata) {
      if (!state.isFile() || state.size === 0) throw new Error('MISSING_SNAPSHOT');
    }
  }
  if (process.platform === 'win32' && !fs.existsSync(java)) {
    throw new Error('JAVA_NOT_FOUND');
  }
}

function portIsFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () =>
      server.close(() => resolve(true))
    );
  });
}

async function awaitSnapshotReady(child, getSpawnError, hasExited) {
  // The URL is the LOCAL child Firestore Emulator; response data is never logged.
  const endpoint =
    `http://127.0.0.1:${EMULATOR_PORT}/v1/projects/${PROJECT_ID}` +
    '/databases/(default)/documents/public_profiles?pageSize=1';

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (getSpawnError() || hasExited()) throw new Error('CHILD_EMULATOR_EXITED');
    try {
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(700),
      });
      if (response.ok) return;
    } catch {
      // The isolated Java process may still be importing the export.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('CHILD_EMULATOR_NOT_READY');
}

async function inspectSnapshot(db) {
  const publicProfiles = await db.collection('public_profiles')
    .limit(MAX_PUBLIC_PROFILES + 1).get();

  assertSourceLimit(publicProfiles.size);
  const report = newAggregate();
  report.scannedPublicProfiles = publicProfiles.size;

  for (const snapshot of publicProfiles.docs) {
    const candidate = candidateFromPublicProfile(snapshot.id, snapshot.data());
    if (!candidate) continue;

    // Read ONLY the owner record and preexisting recovery record inside the
    // isolated import. No mutation, deletion, or automatic publication.
    const [owner, current] = await db.getAll(
      db.doc(`users/${snapshot.id}`),
      db.doc(`${TARGET_COLLECTION}/${snapshot.id}`)
    );

    const disposition = assessExistingRecovery(
      candidate, current.exists ? current.data() : null
    );
    addCandidateToAggregate(report, candidate, disposition, owner.exists);
  }

  // Current incident requires preservation; silently processing a snapshot
  // without legacy values could be mistaken for success on wrong input.
  if (report.candidates === 0) throw new Error('NO_LEGACY_CANDIDATES');

  return report;
}

async function main() {
  // Fail closed BEFORE loading Firebase Admin SDK or launching any process.
  assertRehearsalOnly(process.env, process.argv.slice(2));
  assertLocalFiles();

  if (!(await portIsFree(EMULATOR_PORT)) || !(await portIsFree(WEBSOCKET_PORT))) {
    throw new Error('ISOLATED_PORTS_BUSY');
  }

  const args = [
    '-Duser.language=en', '-Duser.country=US',
    '-jar', jar,
    '--host', '127.0.0.1', '--port', String(EMULATOR_PORT),
    '--websocket_port', String(WEBSOCKET_PORT),
    '--database-edition', 'standard', '--project_id', PROJECT_ID,
    '--seed_from_export', sourceMetadata, '--rules', rules,
    '--single_project_mode', 'true',
  ];
  const child = spawn(java, args, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  let spawnError = null;
  let exited = false;
  child.on('error', (err) => { spawnError = err; });
  child.once('exit', () => { exited = true; });
  // Never forward raw Java logs, which could include private paths or values.
  child.stdout?.resume();
  child.stderr?.resume();

  let db;
  let app;
  let report;
  try {
    await awaitSnapshotReady(child, () => spawnError, () => exited);
    process.env.FIRESTORE_EMULATOR_HOST = ISOLATED_FIRESTORE;
    const requireFunctions = createRequire(
      path.join(root, 'functions', 'package.json')
    );
    const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app');
    const { getFirestore } = requireFunctions('firebase-admin/firestore');

    app = initializeApp({ projectId: PROJECT_ID }, 'legacy-recovery-readonly-rehearsal');
    db = getFirestore(app);
    report = await inspectSnapshot(db);
    await db.terminate();
    db = null;
    await deleteApp(app);
    app = null;
  } finally {
    if (db) {
      try { await db.terminate(); } catch { /* no logging */ }
    }
    if (app) {
      try {
        const requireFunctions = createRequire(path.join(root, 'functions', 'package.json'));
        await requireFunctions('firebase-admin/app').deleteApp(app);
      } catch { /* no logging */ }
    }
    if (child.pid && !exited) {
      const exitPromise = new Promise((resolve) => child.once('exit', resolve));
      child.kill();
      await Promise.race([
        exitPromise,
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
  }

  if (!exited) {
    // Cannot confirm the isolated child exited. Fail closed.
    throw new Error('ISOLATED_CHILD_STILL_RUNNING');
  }

  // Aggregate-only output. Sensitive values and per-owner hashes never leave memory.
  console.log(JSON.stringify(report, null, 2));
}

main().catch(() => {
  console.error(
    '[recovery:discovery] Ensaio isolado nao concluido. Nenhum dado foi alterado.'
  );
  process.exitCode = 2;
});
