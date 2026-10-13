#!/usr/bin/env node
/*
 * Read-only logical comparison of TWO local Firestore Emulator exports.
 * Run from the repository root: node scripts/dev/compare-firestore-snapshots.mjs <suite-dir> <backup-dir>
 * Uses localhost:28080 / websocket:29150, does not modify source exports,
 * does not contact real Firebase, and does not print document fields or IDs.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

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

for (const item of [...exportsToCompare.map(x => x.metadata), jar, java, rules]) {
  if (!fs.existsSync(item)) throw new Error(`Arquivo necessário ausente: ${item}`);
}

async function portIsFree(p) {
  return await new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(p, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}
function digest(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}
function enc(docOrColPath) {
  return docOrColPath.split('/').map(encodeURIComponent).join('/');
}
async function request(url, method = 'GET', body) {
  const response = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Firestore HTTP ${response.status}: ${text.slice(0, 350)}`);
  return text ? JSON.parse(text) : {};
}
async function pages(url, method, buildBody, outputKey) {
  const results = [];
  const tokens = new Set();
  let token = '';
  do {
    const data = method === 'POST'
      ? await request(url, 'POST', buildBody(token))
      : await request(url + (url.includes('?') ? '&' : '?') +
          new URLSearchParams({ pageSize: '1000', showMissing: 'true', ...(token ? { pageToken: token } : {}) }));
    results.push(...(data[outputKey] ?? []));
    token = data.nextPageToken ?? '';
    if (token && tokens.has(token)) throw new Error('Paginação repetida: abortando para evitar loop');
    if (token) tokens.add(token);
  } while (token);
  return results;
}
async function collectionIds(parentDocumentPath = '') {
  const url = parentDocumentPath ? `${base}/${enc(parentDocumentPath)}:listCollectionIds` : `${base}:listCollectionIds`;
  return pages(url, 'POST', token => ({ pageSize: 1000, ...(token ? { pageToken: token } : {}) }), 'collectionIds');
}
async function listDocuments(collectionPath) {
  return pages(`${base}/${enc(collectionPath)}`, 'GET', null, 'documents');
}
async function collect() {
  const result = new Map();
  const seenCollections = new Set();
  const queue = (await collectionIds()).map(id => id);
  let visited = 0;
  while (queue.length) {
    const colPath = queue.shift();
    if (seenCollections.has(colPath)) continue;
    seenCollections.add(colPath);
    visited++;
    const documents = await listDocuments(colPath);
    for (const doc of documents) {
      const marker = '/documents/';
      const idx = doc.name?.indexOf(marker) ?? -1;
      if (idx < 0) throw new Error('Documento sem caminho REST esperado');
      const docPath = doc.name.slice(idx + marker.length);
      // Missing parent documents can still have subcollections.
      if (doc.fields !== undefined || doc.createTime || doc.updateTime) {
        result.set(docPath, {
          fields: digest(doc.fields ?? {}),
          metadata: digest({ createTime: doc.createTime ?? null, updateTime: doc.updateTime ?? null }),
        });
      }
      for (const id of await collectionIds(docPath)) queue.push(`${docPath}/${id}`);
    }
    if (visited % 25 === 0) console.log(`  ...${visited} coleções varridas, ${result.size} documentos`);
    if (visited > 20000 || result.size > 100000) throw new Error('Limite de segurança atingido');
  }
  return { docs: result, collections: seenCollections.size };
}

async function withTemporaryEmulator(snapshot) {
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
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (spawnFailure) throw spawnFailure;
      if (exited) throw new Error('Java encerrou na inicialização');
      await new Promise(r => setTimeout(r, 1000));
      try { await collectionIds(); ready = true; break; }
      catch (e) {
        // Connection refused/503 during startup is expected; other errors aren't.
        if (/Firestore HTTP (403|500)/.test(String(e))) throw e;
      }
    }
    if (!ready) throw new Error('Emulador não respondeu à consulta administrativa');
    return await collect();
  } catch (err) {
    console.error(`Erro ao ler ${snapshot.label}: ${err.message}`);
    console.error(`Trecho final do log Java:\n${logs.slice(-3500)}`);
    throw err;
  } finally {
    if (!exited && child.pid) {
      try { await fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(3000) }); } catch {}
      // Only the exact PID created by THIS script; never touch other Java processes.
      if (!exited) { try { child.kill(); } catch {} }
    }
    await new Promise(r => setTimeout(r, 1500));
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
const principal = await withTemporaryEmulator(exportsToCompare[0]);
console.log(`Principal: ${principal.docs.size} documentos em ${principal.collections} coleções.`);
const recuperado = await withTemporaryEmulator(exportsToCompare[1]);
console.log(`Recuperado: ${recuperado.docs.size} documentos em ${recuperado.collections} coleções.`);
compare(principal, recuperado);