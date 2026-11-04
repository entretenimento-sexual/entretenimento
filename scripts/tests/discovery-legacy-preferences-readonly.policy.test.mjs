import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assertLocalAuditOnly,
  describePrivateFields,
  privateSourceDescriptors,
  makeEmptyAudit,
  addAuditResult,
  PRIVATE_DISCOVERY_INTEREST_FIELDS,
} from '../maintenance/discovery-legacy-preferences-audit.policy.mjs';

const runner = fileURLToPath(
  new URL('../maintenance/audit-discovery-legacy-preferences-readonly.mjs', import.meta.url)
);

test('guard: requires local emulator and expected project', () => {
  assert.doesNotThrow(() =>
    assertLocalAuditOnly({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_PROJECT_ID: 'entretenimento-sexual',
    }, ['--dry-run'])
  );

  for (const host of ['', 'localhost:8080', '127.0.0.1:8081', 'firestore.googleapis.com:443']) {
    assert.throws(() => assertLocalAuditOnly({ FIRESTORE_EMULATOR_HOST: host }));
  }
  for (const name of ['FIREBASE_PROJECT_ID', 'GCP_PROJECT', 'GCLOUD_PROJECT']) {
    assert.throws(() => assertLocalAuditOnly({
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      [name]: 'outro-projeto',
    }));
  }
});

test('guard: refuses all mutation flags including explicit dry-run false', () => {
  for (const arg of ['--apply', '--write', '--dry-run=false', '--force', '--project=prod']) {
    assert.throws(() => assertLocalAuditOnly(
      { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
      [arg]
    ));
  }
});

test('field list matches Firestore Rules and Functions private field boundary', () => {
  const rules = readFileSync(
    fileURLToPath(new URL('../../firestore-rules/public_profiles_next.rules', import.meta.url)),
    'utf8'
  );
  const ruleMatch = rules.match(
    /function lacksPrivateDiscoveryInterestFields\(\) \{[\s\S]*?hasAny\(\[([\s\S]*?)\]\);/
  );
  assert.ok(ruleMatch);
  const ruleFields = [...ruleMatch[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual(PRIVATE_DISCOVERY_INTEREST_FIELDS, ruleFields);

  const backend = readFileSync(
    fileURLToPath(
      new URL('../../functions/src/discovery/public-profile-discovery-projection.ts', import.meta.url)
    ),
    'utf8'
  );
  const backendMatch = backend.match(
    /export const PRIVATE_DISCOVERY_INTEREST_FIELDS = \[([\s\S]*?)\] as const;/
  );
  assert.ok(backendMatch);
  const backendFields = [...backendMatch[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.deepEqual(PRIVATE_DISCOVERY_INTEREST_FIELDS, backendFields);
});

test('shape extraction never emits sensitive values or document IDs', () => {
  const secrets = ['SEGREDO_REAL_UM', 'SEGREDO_REAL_DOIS'];
  const data = {
    publicDescription: 'PÚBLICO',
    interestedInGenders: [...secrets, ' '],
    interestedInOrientations: [],
    preferences: { privatePhrase: 'SEGREDO_INTERNO' },
  };
  const shapes = describePrivateFields(data);
  assert.deepEqual(shapes, [
    { field: 'preferences', kind: 'object', items: 0, invalidArrayItems: 0 },
    { field: 'interestedInGenders', kind: 'array', items: 3, invalidArrayItems: 1 },
    { field: 'interestedInOrientations', kind: 'array', items: 0, invalidArrayItems: 0 },
  ]);
  const output = JSON.stringify(shapes);
  for (const s of [...secrets, 'SEGREDO_INTERNO', 'PÚBLICO']) {
    assert.equal(output.includes(s), false);
  }
  assert.deepEqual(describePrivateFields({ nickname: 'pessoa' }), []);
});

test('aggregate summarizes preservation risk, never raw values/IDs', () => {
  const report = makeEmptyAudit();
  report.scanned = 5;
  const first = describePrivateFields({
    interestedInGenders: ['SEGREDO_A', 'SEGREDO_B', 'SEGREDO_C'],
    interestedInOrientations: [],
  });
  addAuditResult(report, first, [
    { label: 'users', exists: true, fields: [] },
    { label: 'preferencesProfile', exists: false, fields: [] },
    { label: 'preferencesIntent', exists: false, fields: [] },
    { label: 'publicUserPreferencesLegacy', exists: false, fields: [] },
    { label: 'matchProfileLegacy', exists: false, fields: [] },
  ]);

  const second = describePrivateFields({
    interestedInGenders: ['SEGREDO_D', 'SEGREDO_E'],
    interestedInOrientations: ['SEGREDO_F', 'SEGREDO_G', 'SEGREDO_H'],
  });
  addAuditResult(report, second, [
    { label: 'users', exists: true, fields: [] },
    { label: 'preferencesProfile', exists: false, fields: [] },
    { label: 'preferencesIntent', exists: false, fields: [] },
    { label: 'publicUserPreferencesLegacy', exists: false, fields: [] },
    { label: 'matchProfileLegacy', exists: false, fields: [] },
  ]);

  assert.equal(report.scanned, 5);
  assert.equal(report.affected, 2);
  assert.equal(report.affectedWithNonemptyArrays, 2);
  assert.equal(report.arrayItemCounts.interestedInGenders, 5);
  assert.equal(report.arrayItemCounts.interestedInOrientations, 3);
  assert.equal(report.sourceDocumentsFound.users, 2);
  assert.equal(report.sourceDocumentsFound.preferencesProfile, 0);
  assert.equal(report.writesPerformed, 0);
  assert.equal(report.requiresSemanticReview, true);
  assert.equal(report.requiresOwnerVisibilityDecision, true);
  assert.equal(JSON.stringify(report).includes('SEGREDO_'), false);
});

test('private source paths stay internal; only symbolic labels enter reports', () => {
  const paths = privateSourceDescriptors('UID_SENSIVEL');
  assert.equal(paths.length, 5);
  assert.equal(paths[0].path, 'users/UID_SENSIVEL');
  const report = makeEmptyAudit();
  assert.equal(JSON.stringify(report).includes('UID_SENSIVEL'), false);
});

test('runtime fails before Firebase initialization for unsafe environments', () => {
  const base = {
    PATH: process.env.PATH ?? '',
    FIREBASE_PROJECT_ID: 'entretenimento-sexual',
  };
  const scenarios = [
    { env: base, args: [] },
    { env: { ...base, FIRESTORE_EMULATOR_HOST: 'firestore.googleapis.com:443' }, args: [] },
    { env: { ...base, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }, args: ['--apply'] },
    {
      env: { ...base, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080', GCP_PROJECT: 'outro' },
      args: [],
    },
  ];
  for (const scenario of scenarios) {
    const result = spawnSync(process.execPath, [runner, ...scenario.args], {
      env: scenario.env,
      timeout: 5000,
      encoding: 'utf8',
    });
    assert.ifError(result.error);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /\[audit:discovery\]/);
  }
});

test('runtime has no Firestore mutation calls or credential loading', () => {
  const source = readFileSync(runner, 'utf8');
  for (const operation of [
    /\.set\s*\(/,
    /\.update\s*\(/,
    /\.delete\s*\(/,
    /\.commit\s*\(/,
    /\.create\s*\(/,
    /applicationDefault\s*\(/,
    /cert\s*\(/,
  ]) {
    assert.equal(operation.test(source), false, String(operation));
  }
});
