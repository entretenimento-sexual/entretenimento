import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts;
const normal = scripts['test:media:e2e'];
const isolated = scripts['test:media:transaction:isolated:e2e'];
const direct = scripts['test:media:transaction:e2e'];
const mediaWorkflow = readFileSync(resolve(root, '.github/workflows/media-e2e.yml'), 'utf8');
const reconWorkflow = readFileSync(resolve(
  root, '.github/workflows/video-processing-reconciliation-emulator.yml'
), 'utf8');

test('photo E2E exercises full callable flows before launching an isolated revocation emulator', () => {
  assert.match(normal, /npm run rules:build && npm run rules:check && npm run functions:build &&/);
  assert.match(normal, /--only auth,firestore,storage,functions --project demo-entretenimento-media-e2e/);
  assert.match(normal, /node scripts\/tests\/photo-publication\.e2e\.mjs && node scripts\/tests\/photo-social\.e2e\.mjs/);
  assert.ok(!normal.includes('node scripts/tests/media-transaction-revocation.e2e.mjs'));
  assert.ok(normal.endsWith(' && npm run test:media:transaction:isolated:e2e'));
  assert.ok(!normal.includes('firebase --debug '));
});

test('revocation tests keep real Firestore transactions, cases, and fail-closed npm chain', () => {
  assert.equal(isolated,
    'firebase emulators:exec --config firebase.media-e2e.json --only firestore ' +
    '--project demo-entretenimento-media-e2e "node scripts/tests/media-transaction-revocation.e2e.mjs"');
  assert.equal(direct, 'npm run functions:build && npm run test:media:transaction:isolated:e2e');
  const source = readFileSync(resolve(
    root, 'scripts/tests/media-transaction-revocation.e2e.mjs'
  ), 'utf8');
  assert.match(source, /attempts >= 2/);
  assert.match(source, /metric\.get\(\)\)\.exists, false/);
  assert.match(source, /runTransaction\(/);
  assert.match(source, /\[media-tx:e2e\] PASS:/);
  assert.ok(!normal.includes('|| true'));
  assert.ok(!isolated.includes('|| true'));
});

test('both E2E and emulator checks retain coverage and show diagnostic log summary', () => {
  assert.ok(mediaWorkflow.includes('npm run test:media:e2e 2>&1 | tee logs/photo-e2e.log'));
  assert.ok(mediaWorkflow.includes('set -o pipefail'));
  assert.ok(mediaWorkflow.includes('node scripts/quality/summarize-photo-e2e-contention.mjs logs/photo-e2e.log'));
  assert.ok(reconWorkflow.includes('node --test scripts/tests/photo-e2e-isolation.contract.test.mjs scripts/tests/photo-e2e-contention-audit.test.mjs'));
});
