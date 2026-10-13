#!/usr/bin/env node
/*
 * Read-only logical comparison of TWO local Firestore Emulator exports.
 * Run from the repository root: node scripts/dev/compare-firestore-snapshots.mjs <suite-dir> <backup-dir>
 * Uses Firebase Admin SDK against localhost:28080 (websocket:29150).
 * No production access, mutations, personal field values or document IDs in output.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const root = process.cwd();
const port = 28080;
const websocketPort = 29150;
const projectId = 'entretenimento-sexual';
const base = `http://127.0.0.1:${port}/v1/projects/${projectId}/databases/(default)/documents`;
const snapshotDirs = process.argv.slice(2);
if (snapshotDirs.length !== 2) {
  console.error('Uso: node scripts/dev/compare-firestore-snapshots.mjs .emulator-data .emulator-data-backups/orphan-firestore-YYYYMMDD-HHMMSS');
  process.exit(2);
}
const exportsToCompare = snapshotDirs.map((dir, i) => ({
  label: i === 0 ? 'Principal' : 'Recuperado',
  metadata: path.join(path.resolve(root, dir), 'firestore_export', 'firestore_export.overall_export_metadata'),
}));
const jar = path.join(os.homedir(), '.cache', 'firebase', 'emulators', 'cloud-firestore-emulator-v1.22.0.jar');
const javaFromHome = process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java.exe') : null;
const java = javaFromHome && fs.existsSync(javaFromHome)
  ? javaFromHome
  : 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.8-hotspot\\bin\\java.exe';
const rules = path.join(root, 'firestore.rules');

for (const item of [...exportsToCompare.map(x => x.metadata), jar, java, rules, path.join(root, 'functions', 'node_modules', 'firebase-admin')]) {
  if (!fs.existsSync(item)) throw new Error(`Arquivo necessário ausente: ${item}`);
}

async function portIsFree(p) {
  return await new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(p, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

const requireFunctions = createRequire(path.join(root, 'functions', 'package.json'));
const { initializeApp, deleteApp } = requireFunctions('firebase-admin/app');
const { getFirestore } = requireFunctions('firebase-admin/firestore');

function canonical(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) return { specialNumber: String(value) };
  if (typeof value === 'bigint') return { bigint: String(value) };
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return { date: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { bytes: Buffer.from(value).toString('base64') };
  }
  if (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') {
    return { timestamp: [value.seconds, value.nanoseconds] };
  }
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number') {
    return { geopoint: [value.latitude, value.longitude] };
  }
  if (typeof value.path === 'string' && value.firestore && typeof value.get === 'function') {
    return { reference: value.path };
  }
  if (typeof value.toArray === 'function') return { vector: value.toArray().map(canonical) };
  return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function snapshotTime(value) {
  return value ? [value.seconds, value.nanoseconds] : null;
}

async function collect(db) {
  const result = new Map();
  const seenCollections = new Set();
  const queue = await db.listCollections();
  let visited = 0;
  while (queue.length) {
    const col = queue.shift();
    if (seenCollections.has(col.path)) continue;
    seenCollections.add(col.path);
    visited++;

    // listDocuments includes references to nonexistent parent documents,
    // ensuring their descendant collections can still be traversed.
    const docRefs = await col.listDocuments();
    for (let offset = 0; offset < docRefs.length; offset += 50) {
      const chunk = docRefs.slice(offset, offset + 50);
      const snapshots = await db.getAll(...chunk);
      for (const snapshot of snapshots) {
        if (snapshot.exists) {
          result.set(snapshot.ref.path, {
            fields: digest(snapshot.data()),
            metadata: digest({
              createTime: snapshotTime(snapshot.createTime),
              updateTime: snapshotTime(snapshot.updateTime),
            }),
          });
        }
      }
      for (const docRef of chunk) {
        queue.push(...await docRef.listCollections());
      }
      if (result.size > 100000 || queue.length > 20000) {
        throw new Error('Limite de segurança atingido; comparação interrompida.');
      }
    }
    if (visited % 25 === 0) console.log('  ...' + visited + ' coleções varridas, ' + result.size + ' documentos');
    if (visited > 20000) throw new Error('Limite de coleções atingido');
  }
  return { docs: result, collections: seenCollections.size };
}

async function withTemporaryEmulator(snapshot, sequence) {
  if (!(await portIsFree(port)) || !(await portIsFree(websocketPort))) {
    throw new Error('Porta 28080 ou 29150 ocupada. Nada foi iniciado ou encerrado.');
  }
  const args = [
    '-Duser.language=en', '-Duser.country=US', '-jar', jar,
    '--host', '127.0.0.1', '--port', String(port),
    '--websocket_port', String(websocketPort),
    '--database-edition', 'standard', '--project_id', projectId,
    '--seed_from_export', snapshot.metadata, '--rules', rules,
    '--single_project_mode', 'true',
  ];
  const child = spawn(java, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let logs = '';
  let exited = false;
  let spawnFailure;
  child.on('error', e => { spawnFailure = e; });
  child.on('exit', () => { exited = true; });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', part => { logs = (logs + part.toString()).slice(-12000); });
  }

  const previousHost = process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:' + port;
  let app;
  let db;
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (spawnFailure) throw spawnFailure;
      if (exited) throw new Error('Java encerrou na inicialização');
      if (!(await portIsFree(port))) { ready = true; break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (!ready) throw new Error('Porta do emulador não respondeu em 50 segundos');

    app = initializeApp({ projectId }, 'firestore-snapshot-compare-' + sequence);
    db = getFirestore(app);
    return await collect(db);
  } catch (err) {
    console.error('Erro ao ler ' + snapshot.label + ': ' + err.message);
    console.error('Trecho final do log Java:\n' + logs.slice(-3500));
    throw err;
  } finally {
    if (db) { try { await db.terminate(); } catch {} }
    if (app) { try { await deleteApp(app); } catch {} }
    if (previousHost === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
    else process.env.FIRESTORE_EMULATOR_HOST = previousHost;
    if (!exited && child.pid) {
      try { child.kill(); } catch {}
      await Promise.race([
        new Promise(r => child.once('exit', r)),
        new Promise(r => setTimeout(r, 8000)),
      ]);
      if (!exited) console.warn('Processo temporário ' + child.pid + ' não confirmou encerramento; verifique as portas antes de repetir.');
    }
  }
}

function compare(a, b) {
  const keys = new Set([...a.docs.keys(), ...b.docs.keys()]);
  const summary = { same: 0, onlyPrincipal: 0, onlyRecuperado: 0, changedFields: 0, changedTimestamps: 0 };
  const byRoot = new Map();
  function rootRow(k) {
    const root = k.split('/')[0];
    if (!byRoot.has(root)) byRoot.set(root, { colecao: root, principal: 0, recuperado: 0, apenasPrincipal: 0, apenasRecuperado: 0, camposDiferentes: 0, datasDiferentes: 0 });
    return byRoot.get(root);
  }
  for (const k of keys) {
    const x = a.docs.get(k), y = b.docs.get(k), row = rootRow(k);
    if (x) row.principal++;
    if (y) row.recuperado++;
    if (!x) { summary.onlyRecuperado++; row.apenasRecuperado++; }
    else if (!y) { summary.onlyPrincipal++; row.apenasPrincipal++; }
    else if (x.fields !== y.fields) { summary.changedFields++; row.camposDiferentes++; }
    else if (x.metadata !== y.metadata) { summary.changedTimestamps++; row.datasDiferentes++; }
    else summary.same++;
  }
  console.log('\nRESUMO (todas as coleções e subcoleções)');
  console.table({
    'Principal': { colecoes: a.collections, documentos: a.docs.size },
    'Recuperado': { colecoes: b.collections, documentos: b.docs.size },
  });
  console.table(summary);
  const differences = [...byRoot.values()].filter(r => r.apenasPrincipal || r.apenasRecuperado || r.camposDiferentes || r.datasDiferentes);
  if (differences.length) {
    console.log('Diferenças agrupadas por coleção raiz (sem IDs ou dados pessoais):');
    console.table(differences.sort((x, y) => x.colecao.localeCompare(y.colecao)));
  } else console.log('Os documentos, campos e timestamps são logicamente idênticos.');
  console.log('\nSomente leitura: nenhum export foi modificado; Auth e Storage não foram acessados.');
  console.log('Nenhuma mesclagem ou substituição foi realizada.');
}

if (!(await portIsFree(port)) || !(await portIsFree(websocketPort))) {
  throw new Error('Uma das portas de teste está ocupada; não prossiga até verificar o processo.');
}
console.log('Comparação local, isolada e somente de leitura.');
const principal = await withTemporaryEmulator(exportsToCompare[0], 1);
console.log(`Principal: ${principal.docs.size} documentos em ${principal.collections} coleções.`);
const recuperado = await withTemporaryEmulator(exportsToCompare[1], 2);
console.log(`Recuperado: ${recuperado.docs.size} documentos em ${recuperado.collections} coleções.`);
compare(principal, recuperado);