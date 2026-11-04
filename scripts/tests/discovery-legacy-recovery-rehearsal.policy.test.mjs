import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  PROJECT_ID, ISOLATED_FIRESTORE, TARGET_COLLECTION, MAX_PUBLIC_PROFILES,
  assertRehearsalOnly, assertSourceLimit,
  candidateFromPublicProfile, hashLegacy, assessExistingRecovery,
  newAggregate, addCandidateToAggregate,
} from '../maintenance/discovery-legacy-recovery-rehearsal.policy.mjs';

const runner = fileURLToPath(
  new URL('../maintenance/rehearse-discovery-legacy-recovery-readonly.mjs', import.meta.url)
);

test('preflight accepts only explicit dry-run with the correct project', () => {
  assert.doesNotThrow(() => assertRehearsalOnly(
    { FIREBASE_PROJECT_ID: PROJECT_ID, FIRESTORE_EMULATOR_HOST: ISOLATED_FIRESTORE },
    ['--dry-run']
  ));
  for (const args of [
    [], ['--apply'], ['--dry-run=false'], ['--dry-run', '--force'],
    ['--write'], ['--snapshot=remote'],
  ]) assert.throws(() => assertRehearsalOnly({}, args), /ONLY_DRY_RUN/);
});

test('preflight rejects wrong projects, remote/primary Firestore and credentials', () => {
  for (const name of [
    'FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GCP_PROJECT', 'GOOGLE_CLOUD_PROJECT',
  ]) {
    assert.throws(() => assertRehearsalOnly(
      { [name]: 'production-other' }, ['--dry-run']
    ), /PROJECT_MISMATCH/);
  }
  for (const host of [
    '127.0.0.1:8080', 'localhost:8080', 'firestore.googleapis.com:443',
    'http://127.0.0.1:28080',
  ]) {
    assert.throws(() => assertRehearsalOnly({
      FIRESTORE_EMULATOR_HOST: host,
    }, ['--dry-run']), /EXTERNAL_EMULATOR_HOST/);
  }
  assert.throws(() => assertRehearsalOnly({
    GOOGLE_APPLICATION_CREDENTIALS: '/any/credentials.json',
  }, ['--dry-run']), /CREDENTIALS_NOT_ALLOWED/);
});

test('candidate preserves raw ordering, original strings, duplicates and empty arrays', () => {
  const raw = {
    interestedInGenders: [' mulher ', 'mulher', 'mulher', 'NÃO_BINÁRIE'],
    interestedInOrientations: [],
    nickname: 'ignored-public-field',
  };
  const candidate = candidateFromPublicProfile('owner-a', raw);
  assert.ok(candidate);
  assert.equal(candidate.ownerUid, 'owner-a');
  assert.equal(candidate.lifecycle, 'PENDING_REVIEW');
  assert.equal(candidate.visibilityConsentConfirmed, false);
  assert.equal(candidate.sourceCollection, 'public_profiles');
  assert.equal(candidate.schemaVersion, 1);
  assert.equal(candidate.contentSha256.length, 64);
  assert.equal(candidate.contentSha256, hashLegacy('owner-a', candidate.legacyRaw));
  assert.deepEqual(candidate.legacyRaw, {
    interestedInGenders: [' mulher ', 'mulher', 'mulher', 'NÃO_BINÁRIE'],
    interestedInOrientations: [],
  });

  // Changes to source or candidate do not mutate one another.
  raw.interestedInGenders[0] = 'changed-after-snapshot';
  assert.equal(candidate.legacyRaw.interestedInGenders[0], ' mulher ');
});

test('candidate distinguishes a missing field from an empty array', () => {
  const first = candidateFromPublicProfile('owner-b', {
    interestedInGenders: [],
  });
  const second = candidateFromPublicProfile('owner-b', {
    interestedInGenders: [], interestedInOrientations: [],
  });
  assert.notEqual(first.contentSha256, second.contentSha256);
  assert.deepEqual(Object.keys(first.legacyRaw), ['interestedInGenders']);
  assert.deepEqual(Object.keys(second.legacyRaw), [
    'interestedInGenders', 'interestedInOrientations',
  ]);
});

test('does not automatically convert or activate discovery preferences', () => {
  const candidate = candidateFromPublicProfile('owner-a', {
    interestedInGenders: ['legacy-gender'],
    interestedInOrientations: ['legacy-orientation'],
  });
  const forbidden = [
    'hardRules', 'acceptedGenders', 'discoveryPreferences',
    'showSeekingPublicly', 'showIntentPublicly', 'showPreferenceBadges',
  ];
  for (const field of forbidden) {
    assert.equal(JSON.stringify(candidate).includes(field), false);
  }
  assert.equal(TARGET_COLLECTION, 'legacy_discovery_preference_recovery');
  assert.equal(candidate.visibilityConsentConfirmed, false);
});

test('stops for unexplained private fields or unsupported legacy values', () => {
  assert.equal(candidateFromPublicProfile('owner-a', { nickname: 'no-legacy' }), null);
  assert.throws(() => candidateFromPublicProfile('owner-a', {
    interestedInGenders: ['woman'],
    hardRules: { acceptedGenders: ['woman'] },
  }), /UNREVIEWED_PRIVATE_FIELD/);
  for (const values of [null, 'woman', [null], [' '], [32], [''], Array(101).fill('a')]) {
    assert.throws(() => candidateFromPublicProfile('owner-a', {
      interestedInOrientations: values,
    }), /UNSUPPORTED_LEGACY_SHAPE/);
  }
  assert.throws(() => candidateFromPublicProfile('a/b', {
    interestedInGenders: [],
  }), /INVALID_OWNER/);
});

test('idempotence is conservative: identical raw content only; otherwise conflict', () => {
  const candidate = candidateFromPublicProfile('owner-a', {
    interestedInGenders: ['woman', 'man'],
    interestedInOrientations: ['bi'],
  });
  assert.equal(assessExistingRecovery(candidate, null), 'WOULD_CREATE');
  assert.equal(
    assessExistingRecovery(candidate, structuredClone(candidate)), 'ALREADY_PRESERVED'
  );

  for (const patch of [
    { ownerUid: 'owner-other' },
    { contentSha256: '0'.repeat(64) },
    { visibilityConsentConfirmed: true },
    { lifecycle: 'CONFIRMED' },
    { sourceCollection: 'users' },
    { legacyRaw: { interestedInGenders: ['man'], interestedInOrientations: ['bi'] } },
  ]) {
    assert.throws(() => assessExistingRecovery(candidate, {
      ...structuredClone(candidate), ...patch,
    }), /RECOVERY_CONFLICT/);
  }
});

test('aggregate simulates 2 owners and 8 entries without leaking raw values', () => {
  const candidateA = candidateFromPublicProfile('private-owner-alpha', {
    interestedInGenders: ['SECRET_A', 'SECRET_B', 'SECRET_C'],
    interestedInOrientations: [],
  });
  const candidateB = candidateFromPublicProfile('private-owner-beta', {
    interestedInGenders: ['SECRET_D', 'SECRET_E'],
    interestedInOrientations: ['SECRET_F', 'SECRET_G', 'SECRET_H'],
  });
  const aggregate = newAggregate();
  aggregate.scannedPublicProfiles = 5;
  addCandidateToAggregate(
    aggregate, candidateA, assessExistingRecovery(candidateA, null), true
  );
  addCandidateToAggregate(
    aggregate, candidateB, assessExistingRecovery(candidateB, null), true
  );
  assert.equal(aggregate.candidates, 2);
  assert.equal(aggregate.ownerDocumentsFound, 2);
  assert.equal(aggregate.interestedInGendersItems, 5);
  assert.equal(aggregate.interestedInOrientationsItems, 3);
  assert.equal(aggregate.wouldCreate, 2);
  assert.equal(aggregate.alreadyPreserved, 0);
  assert.equal(aggregate.recoveredDocumentsWritten, 0);
  assert.equal(aggregate.publicDocumentsWritten, 0);
  assert.equal(aggregate.activePreferencesWritten, 0);
  assert.equal(aggregate.sourceTimestampFidelityProven, false);

  const display = JSON.stringify(aggregate);
  for (const privateText of [
    'SECRET_', 'private-owner-alpha', 'private-owner-beta',
    candidateA.contentSha256, candidateB.contentSha256,
  ]) {
    assert.equal(display.includes(privateText), false);
  }
});

test('orphan owners and unknown dispositions fail closed', () => {
  const candidate = candidateFromPublicProfile('owner-a', {
    interestedInGenders: ['woman'],
  });
  assert.throws(() => addCandidateToAggregate(
    newAggregate(), candidate, 'WOULD_CREATE', false
  ), /OWNER_DOCUMENT_MISSING/);
  assert.throws(() => addCandidateToAggregate(
    newAggregate(), candidate, 'MIGRATED', true
  ), /UNKNOWN_DISPOSITION/);
});

test('never silently handles more than 200 public documents', () => {
  assert.doesNotThrow(() => assertSourceLimit(MAX_PUBLIC_PROFILES));
  assert.throws(() => assertSourceLimit(MAX_PUBLIC_PROFILES + 1), /SOURCE_LIMIT_EXCEEDED/);
});

test('CLI refuses unsafe invocation before using Java or Firebase Admin', () => {
  for (const scenario of [
    { env: {}, args: [] },
    { env: {}, args: ['--apply'] },
    { env: { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, args: ['--dry-run'] },
    {
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/not/used.json' },
      args: ['--dry-run'],
    },
  ]) {
    const result = spawnSync(process.execPath, [runner, ...scenario.args], {
      env: { PATH: process.env.PATH ?? '', ...scenario.env },
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Ensaio isolado nao concluido/);
  }
});

test('isolated emulator readiness does not require forbidden public profile list', () => {
  const source = readFileSync(runner, 'utf8');
  const rules = readFileSync(
    fileURLToPath(
      new URL('../../firestore-rules/public_profiles_next.rules', import.meta.url)
    ),
    'utf8'
  );
  assert.match(rules, /allow list:\\s*if false;/);
  assert.match(source, /portAcceptsConnections\\(EMULATOR_PORT\\)/);
  assert.match(source, /net\\.createConnection\\(\\{ host: '127\\.0\\.0\\.1', port \\}\\)/);
  assert.doesNotMatch(source, /documents\\/public_profiles/);
  assert.doesNotMatch(source, /\\bfetch\\s*\\(/);
});

test('runner rejects locally generated Rules without the #239 quarantine', () => {
  const source = readFileSync(runner, 'utf8');
  const rulesManifest = readFileSync(
    fileURLToPath(
      new URL('../../firestore-rules/tools-rules/firestore-rules-parts.mjs', import.meta.url)
    ), 'utf8'
  );
  assert.match(source, /RECOVERY_RULES_NOT_BUILT/);
  assert.match(source, /legacy_discovery_preference_recovery\\.rules/);
  assert.match(source, /match \\/legacy_discovery_preference_recovery\\/\\{ownerUid\\}/);
  assert.match(rulesManifest, /'legacy_discovery_preference_recovery\\.rules'/);
});

test('runner never invokes Firestore write operations or emits raw snapshots', () => {
  const source = readFileSync(runner, 'utf8');
  for (const operation of [
    /\.set\s*\(/, /\.add\s*\(/, /\.update\s*\(/,
    /\.delete\s*\(/, /\.create\s*\(/, /\.commit\s*\(/,
    /\.batch\s*\(/, /\.runTransaction\s*\(/, /\.bulkWriter\s*\(/,
    /writeFile/, /appendFile/, /emulators:export/,
  ]) {
    assert.equal(operation.test(source), false, String(operation));
  }
  assert.equal(source.includes('console.log(JSON.stringify(report, null, 2))'), true);
});
