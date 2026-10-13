import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateEmulatorSnapshotImport as check } from '../dev/emulator-snapshot-preflight.mjs';

function temporary(run) {
  const p = fs.mkdtempSync(path.join(os.tmpdir(), 'emulator-preflight-'));
  try { return run(p); }
  finally { fs.rmSync(p, { recursive: true, force: true }); }
}
function valid(root) {
  for (const d of ['auth_export', 'firestore_export', 'storage_export']) {
    fs.mkdirSync(path.join(root, d));
  }
  fs.writeFileSync(path.join(root, 'auth_export', 'accounts.json'), '[]');
  fs.writeFileSync(path.join(root, 'firestore_export', 'firestore_export.overall_export_metadata'), 'metadata');
  fs.writeFileSync(path.join(root, 'firebase-export-metadata.json'), JSON.stringify({
    version: '15.29.0',
    auth: { path: 'auth_export' },
    firestore: { path: 'firestore_export', metadata_file: 'firestore_export/firestore_export.overall_export_metadata' },
    storage: { path: 'storage_export' },
  }));
}
const all = ['auth', 'firestore', 'storage', 'functions'];

test('missing or empty snapshot starts fresh', () => temporary(p => {
  assert.equal(check(path.join(p, 'missing'), all), false);
  assert.equal(check(p, all), false);
}));
test('complete snapshot import is accepted', () => temporary(p => {
  valid(p);
  assert.equal(check(p, all), true);
}));
test('nonempty directory without manifest fails closed', () => temporary(p => {
  fs.writeFileSync(path.join(p, 'data'), 'some data');
  assert.throws(() => check(p, all), /não vazio/);
}));
test('missing storage export fails closed', () => temporary(p => {
  valid(p); fs.rmSync(path.join(p, 'storage_export'), { recursive: true });
  assert.throws(() => check(p, all), /storage/);
}));
test('missing auth accounts fails closed', () => temporary(p => {
  valid(p); fs.rmSync(path.join(p, 'auth_export', 'accounts.json'));
  assert.throws(() => check(p, all), /accounts.json/);
}));
test('missing firestore metadata fails closed', () => temporary(p => {
  valid(p); fs.rmSync(path.join(p, 'firestore_export', 'firestore_export.overall_export_metadata'));
  assert.throws(() => check(p, all), /metadata_file/);
}));
test('invalid JSON fails closed', () => temporary(p => {
  valid(p); fs.writeFileSync(path.join(p, 'firebase-export-metadata.json'), '{');
  assert.throws(() => check(p, all), /JSON inválido/);
}));
test('out-of-directory path is blocked', () => temporary(p => {
  valid(p);
  const meta = path.join(p, 'firebase-export-metadata.json');
  const obj = JSON.parse(fs.readFileSync(meta, 'utf8'));
  obj.storage.path = '../outside';
  fs.writeFileSync(meta, JSON.stringify(obj));
  assert.throws(() => check(p, all), /fora do diretório/);
}));
test('missing requested service fails, unrequested service can be absent', () => temporary(p => {
  valid(p);
  const meta = path.join(p, 'firebase-export-metadata.json');
  const obj = JSON.parse(fs.readFileSync(meta, 'utf8'));
  delete obj.auth;
  fs.writeFileSync(meta, JSON.stringify(obj));
  assert.throws(() => check(p, all), /não contém exportação de auth/);
  assert.equal(check(p, ['firestore', 'storage']), true);
}));
