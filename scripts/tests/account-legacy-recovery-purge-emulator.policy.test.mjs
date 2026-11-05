import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  SYNTHETIC_PURGE_PROJECT, SYNTHETIC_PURGE_HOST,
  SYNTHETIC_PURGE_PORT, SYNTHETIC_PURGE_WEBSOCKET_PORT,
  SYNTHETIC_PURGE_FLAG, assertSyntheticPurgeInvocation,
  assertSyntheticEmulatorReport,
} from '../maintenance/account-legacy-recovery-purge-emulator.policy.mjs';

const runner = fileURLToPath(new URL(
  '../maintenance/rehearse-account-legacy-recovery-purge-synthetic.mjs',
  import.meta.url
));

const expected = Object.freeze({
  mode: 'SYNTHETIC_FIRESTORE_PURGE_E2E',
  project: SYNTHETIC_PURGE_PROJECT,
  host: SYNTHETIC_PURGE_HOST,
  originalCheckpointImported: false,
  productionModified: false,
  primaryEmulatorModified: false,
  successRecoveryDocumentsDeleted: 1,
  successDescendantsDeleted: 2,
  idempotentRepeatRemoved: 0,
  orphanDescendantCleared: true,
  otherOwnerPreserved: true,
  mismatchedOwnerRejected: true,
  expiredLeaseRejected: true,
  activeAccountRejected: true,
  preferencesDomainFailedOnConflict: true,
  accountFinalizationBlocked: true,
  staleWriteAfterDeletionRejected: true,
  writerBeforeDeletionPurged: true,
  recreationAfterPurgeRejected: true,
  raceOwners: 2,
  concurrentWritePurgedOrDenied: true,
  privateRecoveryWriterEnabled: false,
});

test('synthetic runner accepts only explicit test flag with unbound environment', () => {
  assert.equal(SYNTHETIC_PURGE_PROJECT.startsWith('demo-'), true);
  assert.equal(SYNTHETIC_PURGE_PORT, 28080);
  assert.equal(SYNTHETIC_PURGE_WEBSOCKET_PORT, 29150);
  assert.doesNotThrow(() =>
    assertSyntheticPurgeInvocation({}, [SYNTHETIC_PURGE_FLAG]));
  for (const args of [
    [], ['--dry-run'], ['--apply'], ['--force'],
    [SYNTHETIC_PURGE_FLAG, '--export'],
  ]) {
    assert.throws(() => assertSyntheticPurgeInvocation({}, args),
      /SYNTHETIC_PURGE_EXPLICIT_FLAG_REQUIRED/);
  }
});

test('rejects any credential, project selection or existing emulator context', () => {
  for (const key of [
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT',
    'GCLOUD_PROJECT', 'GCP_PROJECT', 'FIREBASE_PROJECT_ID',
    'FIREBASE_CONFIG', 'FUNCTIONS_EMULATOR', 'FIRESTORE_EMULATOR_HOST',
  ]) {
    assert.throws(() => assertSyntheticPurgeInvocation({
      [key]: key === 'FIRESTORE_EMULATOR_HOST' ? SYNTHETIC_PURGE_HOST : 'value',
    }, [SYNTHETIC_PURGE_FLAG]), /SYNTHETIC_PURGE_UNSAFE_ENVIRONMENT/);
  }
});

test('report accepts only full synthetic proof and contains no owner IDs', () => {
  const report = assertSyntheticEmulatorReport(expected);
  assert.equal(report.mode, 'SYNTHETIC_FIRESTORE_PURGE_E2E');
  assert.equal(Object.isFrozen(report), true);
  for (const secret of [
    'synthetic-success-owner', 'legacyRaw', 'contentSha256',
    'purgeLeaseOwner', 'privateIntents',
  ]) {
    assert.equal(JSON.stringify(report).includes(secret), false);
  }
  for (const key of [
    'originalCheckpointImported', 'productionModified',
    'primaryEmulatorModified', 'orphanDescendantCleared',
    'otherOwnerPreserved', 'mismatchedOwnerRejected',
    'expiredLeaseRejected', 'activeAccountRejected',
    'preferencesDomainFailedOnConflict', 'accountFinalizationBlocked',
    'staleWriteAfterDeletionRejected', 'writerBeforeDeletionPurged',
    'recreationAfterPurgeRejected', 'concurrentWritePurgedOrDenied',
    'privateRecoveryWriterEnabled',
  ]) {
    assert.throws(() => assertSyntheticEmulatorReport({
      ...expected, [key]: !expected[key],
    }), /SYNTHETIC_PURGE_EVIDENCE_INCOMPLETE/);
  }
  assert.throws(() => assertSyntheticEmulatorReport({
    ...expected, unexpectedUid: 'synthetic-owner-secret',
  }), /SYNTHETIC_PURGE_EVIDENCE_INCOMPLETE/);
  for (const [key, value] of [
    ['successRecoveryDocumentsDeleted', 0],
    ['successDescendantsDeleted', 1],
    ['idempotentRepeatRemoved', 1],
    ['raceOwners', 0],
  ]) {
    assert.throws(() => assertSyntheticEmulatorReport({
      ...expected, [key]: value,
    }), /SYNTHETIC_PURGE_EVIDENCE_INCOMPLETE/);
  }
});

test('dangerous CLI invocations exit before contacting Firestore or launching Java', () => {
  for (const { args, env } of [
    { args: [], env: {} },
    { args: ['--apply'], env: {} },
    { args: [SYNTHETIC_PURGE_FLAG],
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/sensitive.json' } },
    { args: [SYNTHETIC_PURGE_FLAG],
      env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } },
  ]) {
    const p = spawnSync(process.execPath, [runner, ...args], {
      env: { PATH: process.env.PATH ?? '', ...env },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ifError(p.error);
    assert.equal(p.status, 2);
    assert.equal(p.stdout, '');
    assert.match(p.stderr, /Ensaio sintetico B2.4 nao concluido/);
    assert.equal(p.stderr.includes('/sensitive.json'), false);
  }
});

test('runner uses compiled real adapter, fresh empty emulator, and no import/export', () => {
  const source = readFileSync(runner, 'utf8');
  assert.match(source, /requireFunctions\('\.\/lib\/account_lifecycle\/account-data-deletion\.firestore\.js'\)/);
  assert.match(source, /new FirestoreAccountDataDeletionAdapter\(\)/);
  assert.match(source, /SYNTHETIC_DATABASE_NOT_EMPTY/);
  assert.match(source, /documentTreeAbsent\(recovery\(owner\)\)/);
  assert.match(source, /documentTreeAbsent\(recovery\(orphan\)\)/);
  assert.match(source, /realAdapter\.deletePreferences\(owner\)/);
  assert.match(source, /realAdapter\.deletePreferences\(mismatch\)/);
  assert.match(source, /executor\.executeAccountDataDeletionDomains/);
  assert.match(source, /canFinalizePrivateUserDeletion/);
  assert.match(source, /exerciseSyntheticOwnerFenceRaces/);
  assert.match(source, /portIsFree\(SYNTHETIC_PURGE_PORT\)/);
  assert.match(source, /await stopChild\(child/);
  assert.match(source, /--single_project_mode/);
  for (const dangerous of [
    "'--seed_from_export',",
    "'--export-on-exit',",
    'emulators:export',
    'firebase deploy',
    'purgeDeletedAccounts()',
    "collection('public_profiles').doc(owner).delete()",
  ]) {
    assert.equal(source.includes(dangerous), false, dangerous);
  }
});
