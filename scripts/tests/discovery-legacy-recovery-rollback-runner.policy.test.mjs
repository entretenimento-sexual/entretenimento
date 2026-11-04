// Pure/synthetic tests: no emulator, credentials, or operator data.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  INCIDENT_CANDIDATES, INCIDENT_GENDER_ITEMS, INCIDENT_ORIENTATION_ITEMS,
  assertIsolatedRollbackInvocation, assertExpectedIncident,
  assertScannedPublicProfiles, digestDocumentFields,
  validateLogicalSnapshot, safeRollbackSummary,
} from '../maintenance/discovery-legacy-recovery-rollback-runner.policy.mjs';

const runner = fileURLToPath(
  new URL('../maintenance/rehearse-discovery-legacy-recovery-rollback.mjs',
    import.meta.url)
);

const safeEnv = Object.freeze({
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:28080',
  FIREBASE_PROJECT_ID: 'entretenimento-sexual',
});

test('explicit isolated-only CLI flag is mandatory', () => {
  assert.doesNotThrow(() => assertIsolatedRollbackInvocation(
    {}, ['--isolated-rollback-test']
  ));
  assert.doesNotThrow(() => assertIsolatedRollbackInvocation(
    safeEnv, ['--isolated-rollback-test']
  ));
  for (const args of [
    [], ['--dry-run'], ['--apply'], ['--execute'],
    ['--isolated-rollback-test', '--force'],
    ['--isolated-rollback-test', '--project=production'],
  ]) {
    assert.throws(() => assertIsolatedRollbackInvocation({}, args),
      /EXPLICIT_ISOLATED_ROLLBACK_FLAG_REQUIRED/);
  }
});

test('preflight refuses any remote/primary emulator or production credentials', () => {
  for (const host of [
    '127.0.0.1:8080', 'localhost:28080', '0.0.0.0:28080',
    'firestore.googleapis.com:443', 'https://127.0.0.1:28080',
  ]) {
    assert.throws(() => assertIsolatedRollbackInvocation({
      ...safeEnv, FIRESTORE_EMULATOR_HOST: host,
    }, ['--isolated-rollback-test']), /UNSAFE_PRESELECTED_FIRESTORE_HOST/);
  }
  assert.throws(() => assertIsolatedRollbackInvocation({
    ...safeEnv, GOOGLE_APPLICATION_CREDENTIALS: '/tmp/secret.json',
  }, ['--isolated-rollback-test']), /CREDENTIALS_NOT_ALLOWED/);
  for (const key of [
    'FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GCP_PROJECT',
    'GOOGLE_CLOUD_PROJECT',
  ]) {
    assert.throws(() => assertIsolatedRollbackInvocation({
      ...safeEnv, [key]: 'production-project',
    }, ['--isolated-rollback-test']), /PROJECT_MISMATCH/);
  }
});

test('incident counts must match observed 2 candidates, 5 and 3 items', () => {
  assert.equal(INCIDENT_CANDIDATES, 2);
  assert.equal(INCIDENT_GENDER_ITEMS, 5);
  assert.equal(INCIDENT_ORIENTATION_ITEMS, 3);
  assert.doesNotThrow(() => assertExpectedIncident(2, 5, 3));
  for (const numbers of [[1, 5, 3], [2, 6, 3], [2, 5, 4], [0, 0, 0]]) {
    assert.throws(() => assertExpectedIncident(...numbers),
      /SNAPSHOT_INCIDENT_DOES_NOT_MATCH/);
  }
  assert.doesNotThrow(() => assertScannedPublicProfiles(5));
  assert.throws(() => assertScannedPublicProfiles(201),
    /PUBLIC_PROFILE_LIMIT_EXCEEDED/);
});

test('canonical hashes preserve value changes and ignore object key order', () => {
  const first = {
    secret: ['A', 'a', ' a '],
    profile: { z: 1, a: false },
    savedAt: { seconds: 1000, nanoseconds: 25 },
  };
  const reordered = {
    savedAt: { nanoseconds: 25, seconds: 1000 },
    profile: { a: false, z: 1 },
    secret: ['A', 'a', ' a '],
  };
  assert.equal(digestDocumentFields(first), digestDocumentFields(reordered));
  assert.notEqual(digestDocumentFields(first), digestDocumentFields({
    ...first, secret: ['A', 'a'],
  }));
  assert.notEqual(digestDocumentFields(first), digestDocumentFields({
    ...first, savedAt: { seconds: 1001, nanoseconds: 25 },
  }));
  assert.equal(digestDocumentFields(first).length, 64);
});

test('snapshot comparison detects removed, added and altered documents without leaking IDs', () => {
  const before = new Map([
    ['users/SENSITIVE_UID', 'sha-a'],
    ['public_profiles/SENSITIVE_UID', 'sha-b'],
  ]);
  assert.deepEqual(validateLogicalSnapshot(before, new Map(before)), {
    documentsVerified: 2, contentDifferences: 0,
  });
  assert.throws(() => validateLogicalSnapshot(before, new Map([
    ['users/SENSITIVE_UID', 'sha-c'],
    ['public_profiles/SENSITIVE_UID', 'sha-b'],
  ])), /SNAPSHOT_CONTENT_MISMATCH/);
  assert.throws(() => validateLogicalSnapshot(before, new Map([
    ['users/SENSITIVE_UID', 'sha-a'],
  ])), /SNAPSHOT_DOCUMENT_COUNT_MISMATCH/);
  assert.throws(() => validateLogicalSnapshot(before, new Map([
    ...before, ['legacy_discovery_preference_recovery/SENSITIVE_UID', 'sha-c'],
  ])), /SNAPSHOT_DOCUMENT_COUNT_MISMATCH/);
});

test('aggregate report proves idempotence/rollback without leaking raw values', () => {
  const report = safeRollbackSummary({
    documentsVerified: 563,
    scanned: 5, candidateCount: 2, genders: 5, orientations: 3,
    first: { createdCount: 2, alreadyPreservedCount: 0 },
    second: { createdCount: 0, alreadyPreservedCount: 2 },
    deleted: { deletedCount: 2 },
  });
  assert.equal(report.mode, 'ISOLATED_IMPORT_COPY_VERIFY_ROLLBACK');
  assert.equal(report.snapshotDocumentsVerified, 563);
  assert.equal(report.contentDifferences, 0);
  assert.equal(report.rolledBack, 2);
  assert.equal(report.originalExportModified, false);
  assert.equal(report.productionModified, false);
  assert.equal(report.metadataTimestampFidelityProven, false);
  for (const key of ['SENSITIVE_UID', 'SECRET_ORIENTATION', 'contentSha256']) {
    assert.equal(JSON.stringify(report).includes(key), false);
  }
  assert.throws(() => safeRollbackSummary({
    documentsVerified: 563,
    scanned: 5, candidateCount: 2, genders: 5, orientations: 3,
    first: { createdCount: 2, alreadyPreservedCount: 0 },
    second: { createdCount: 1, alreadyPreservedCount: 1 },
    deleted: { deletedCount: 2 },
  }), /IDEMPOTENCE_OR_ROLLBACK_FAILURE/);
});

test('unsafe CLI invocations fail before reading a snapshot or starting Java', () => {
  for (const setup of [
    { args: [], env: {} },
    { args: ['--apply'], env: {} },
    { args: ['--isolated-rollback-test'],
      env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } },
    { args: ['--isolated-rollback-test'],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/remote.json' } },
  ]) {
    const result = spawnSync(process.execPath, [runner, ...setup.args], {
      env: { PATH: process.env.PATH ?? '', ...setup.env },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr.includes('Nao execute a recuperacao persistente.'), true);
  }
});

test('runner touches only isolated-memory data and rejects silent export/deploy', () => {
  const source = readFileSync(runner, 'utf8');
  const contract = readFileSync(
    fileURLToPath(
      new URL('../maintenance/discovery-legacy-recovery-transaction.policy.mjs',
        import.meta.url)
    ), 'utf8');
  assert.equal(source.includes('seed_from_export'), true);
  assert.equal(source.includes('ISOLATED_FIRESTORE'), true);
  assert.equal(source.includes('validateLogicalSnapshot'), true);
  assert.equal(source.includes('rollbackIsolatedRecovery'), true);
  assert.equal(source.includes('safeRollbackSummary'), true);
  assert.equal(source.includes('fingerprintExport'), true);
  assert.equal(source.includes('console.log(JSON.stringify(result, null, 2))'), true);
  assert.equal(contract.includes('tx.create(refs.recovery'), true);
  assert.equal(contract.includes('tx.delete(refs.recovery'), true);
  for (const unsafe of [
    'writeFileSync(', 'appendFileSync(', 'emulators:export',
    'firebase deploy', '--export-on-exit', 'public_profiles.set(',
    'updateDoc(', 'setDoc(',
  ]) {
    assert.equal(source.includes(unsafe), false, unsafe);
  }
});
