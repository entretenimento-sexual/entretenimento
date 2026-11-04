import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  RECOVERY_PERSISTENCE_POLICY_VERSION,
  MANDATORY_RELEASE_BLOCKERS,
  PROPOSED_RETENTION_DAYS,
  MS_PER_DAY,
  prepareSensitiveRecoveryRetentionPlan,
  makeRecoveryAuditSummary,
  assertPersistentRecoveryMayExecute,
} from '../maintenance/discovery-legacy-recovery-persistence.policy.mjs';
import {
  candidateFromPublicProfile,
} from '../maintenance/discovery-legacy-recovery-rehearsal.policy.mjs';

const nowMs = 1_783_000_000_000;
const proof = Object.freeze({
  mode: 'ISOLATED_IMPORT_COPY_VERIFY_ROLLBACK',
  project: 'entretenimento-sexual',
  host: '127.0.0.1:28080',
  scannedPublicProfiles: 5,
  candidates: 2,
  interestedInGendersItems: 5,
  interestedInOrientationsItems: 3,
  initiallyCreated: 2,
  idempotentSecondRunCreated: 0,
  rolledBack: 2,
  snapshotDocumentsVerified: 563,
  contentDifferences: 0,
  mainEmulatorModified: false,
  originalExportModified: false,
  productionModified: false,
  metadataTimestampFidelityProven: false,
  ownerConsentRequired: true,
});

function fixtures() {
  return [
    candidateFromPublicProfile('synthetic-owner-one', {
      interestedInGenders: ['SECRET_ONE', 'SECRET_TWO', 'SECRET_THREE'],
      interestedInOrientations: [],
    }),
    candidateFromPublicProfile('synthetic-owner-two', {
      interestedInGenders: ['SECRET_FOUR', 'SECRET_FIVE'],
      interestedInOrientations: ['SECRET_SIX', 'SECRET_SEVEN', 'SECRET_EIGHT'],
    }),
  ];
}

const prepare = (overrides = {}) =>
  prepareSensitiveRecoveryRetentionPlan({
    candidates: fixtures(),
    isolatedRehearsalReport: proof,
    nowMs,
    ...overrides,
  });

test('prepares only two private intents, with exact source digest and no raw values', () => {
  const { privateIntents, report } = prepare();
  assert.equal(privateIntents.length, 2);
  assert.deepEqual(privateIntents.map((i) => i.recoveryStatus), [
    'PENDING_REVIEW', 'PENDING_REVIEW',
  ]);
  assert.equal(
    privateIntents[0].recoveryPath,
    'legacy_discovery_preference_recovery/synthetic-owner-one'
  );
  assert.equal(privateIntents[0].sourcePath, 'public_profiles/synthetic-owner-one');
  assert.equal(privateIntents[0].expectedSourceContentSha256, fixtures()[0].contentSha256);
  assert.equal(privateIntents[0].proposedReviewDeadline,
    nowMs + PROPOSED_RETENTION_DAYS * MS_PER_DAY);
  assert.equal(privateIntents[0].visibilityConsentConfirmed, false);
  assert.equal(privateIntents[0].ownerDeletionMustPurge, true);

  for (const key of ['legacyRaw', 'interestedInGenders',
    'interestedInOrientations', 'showSeekingPublicly', 'showIntentPublicly']) {
    assert.equal(JSON.stringify(privateIntents).includes(key), false);
  }

  assert.equal(report.policyVersion, RECOVERY_PERSISTENCE_POLICY_VERSION);
  assert.equal(report.phase, 'B2_2_PREPARATION_ONLY');
  assert.equal(report.decision, 'BLOCKED');
  assert.equal(report.candidateCount, 2);
  assert.equal(report.legacyEntryCount, 8);
  assert.equal(report.persistentWritesAllowed, false);
  assert.equal(report.sourceFieldsDeletionAllowed, false);
  assert.equal(report.visibilityActivationAllowed, false);
  assert.equal(report.accountDeletionPurgeReady, false);
  assert.equal(report.ownerConsentRequired, true);
  assert.deepEqual(report.documentedBlockers, MANDATORY_RELEASE_BLOCKERS);
  assert.ok(Object.isFrozen(report));
});

test('public report and audit summary never emit UID, raw strings or digests', () => {
  const { privateIntents, report } = prepare();
  const audit = makeRecoveryAuditSummary({
    action: 'B2_2_PLAN_PREPARED', report,
  });
  assert.deepEqual(audit, {
    policyVersion: 1,
    action: 'B2_2_PLAN_PREPARED',
    outcome: 'BLOCKED',
    candidateCount: 2,
    legacyEntryCount: 8,
    writesPerformed: 0,
    requiresIndependentAdministrativeAuthorization: true,
  });
  const serialized = JSON.stringify({ report, audit });
  for (const item of ['synthetic-owner-', 'SECRET_',
    privateIntents[0].expectedSourceContentSha256, 'legacyRaw']) {
    assert.equal(serialized.includes(item), false, item);
  }
});

test('rejects a changed or forged B2.1 proof without disclosing identifiers', () => {
  const invalid = [
    { mode: 'DRY_RUN' },
    { host: '127.0.0.1:8080' },
    { project: 'other-project' },
    { initiallyCreated: 1 },
    { idempotentSecondRunCreated: 1 },
    { rolledBack: 1 },
    { snapshotDocumentsVerified: 0 },
    { contentDifferences: 1 },
    { mainEmulatorModified: true },
    { originalExportModified: true },
    { productionModified: true },
    { ownerConsentRequired: false },
    { metadataTimestampFidelityProven: true },
  ];
  for (const patch of invalid) {
    assert.throws(
      () => prepare({ isolatedRehearsalReport: { ...proof, ...patch } }),
      /B21_PROOF_NOT_SATISFIED/
    );
  }
});

test('rejects invalid candidates, duplicates and mismatched private item counts', () => {
  const candidates = fixtures();
  assert.throws(() => prepare({ candidates: [] }), /INVALID_CANDIDATE_COUNT/);
  assert.throws(() => prepare({ candidates: [candidates[0], candidates[0]] }),
    /DUPLICATE_OWNER/);
  assert.throws(() => prepare({ candidates: [candidates[0]] }),
    /SNAPSHOT_INCIDENT_DOES_NOT_MATCH/);
  const changed = { ...candidates[0], contentSha256: '0'.repeat(64) };
  assert.throws(() => prepare({ candidates: [changed, candidates[1]] }),
    /CANDIDATE_INTEGRITY_FAILURE/);
  assert.throws(() => prepare({ nowMs: Number.NaN }), /INVALID_REVIEW_TIMESTAMP/);
  assert.throws(() => prepare({ nowMs: 0 }), /INVALID_REVIEW_TIMESTAMP/);
  assert.throws(() => prepare({ nowMs: 4_000_000_000_001 }),
    /INVALID_REVIEW_TIMESTAMP/);
});

test('retention deadline is a review proposal, not an automatic expiry or consent', () => {
  const { report, privateIntents } = prepare();
  assert.equal(report.proposedRetentionDays, 30);
  assert.equal(report.ownerConsentRequired, true);
  assert.equal(report.semanticReviewRequired, true);
  assert.equal(report.accountDeletionPurgeReady, false);
  assert.ok(MANDATORY_RELEASE_BLOCKERS.includes('RETENTION_EXPIRY_JOB_NOT_INTEGRATED'));
  assert.ok(MANDATORY_RELEASE_BLOCKERS.includes('ACCOUNT_DELETION_PURGE_NOT_INTEGRATED'));
  assert.ok(MANDATORY_RELEASE_BLOCKERS.includes('SERVER_VERIFIED_ADMIN_AUTH_NOT_IMPLEMENTED'));
  assert.equal(privateIntents[0].recoveryStatus, 'PENDING_REVIEW');
});

test('audit creation uses a strict event and field allowlist', () => {
  const { report } = prepare();
  for (const action of [
    'B2_2_PLAN_PREPARED', 'B2_2_PLAN_BLOCKED', 'B2_2_PLAN_REJECTED',
  ]) {
    assert.equal(makeRecoveryAuditSummary({ action, report }).action, action);
  }
  for (const action of ['B2_2_WRITE', 'DELETE_LEGACY_FIELDS',
    'APPROVED', '', null, undefined]) {
    assert.throws(() => makeRecoveryAuditSummary({ action, report }),
      /UNAUTHORIZED_AUDIT_ACTION/);
  }
  assert.throws(() => makeRecoveryAuditSummary({
    action: 'B2_2_PLAN_PREPARED',
    report: { ...report, persistentWritesAllowed: true },
  }), /UNTRUSTED_AUDIT_REPORT/);
});

test('no client-provided or environmental approval enables persistence', () => {
  for (const supplied of [
    undefined,
    { admin: true, approved: true },
    { approved: true, force: true, target: 'production' },
    { credentials: 'anything', project: 'entretenimento-sexual' },
  ]) {
    assert.throws(() => assertPersistentRecoveryMayExecute(supplied),
      /PERSISTENT_RECOVERY_NOT_AUTHORIZED/);
  }
});

test('policy module has no Firestore writer, callable, process runner or logs', () => {
  const filename = fileURLToPath(
    new URL('../maintenance/discovery-legacy-recovery-persistence.policy.mjs',
      import.meta.url)
  );
  const source = readFileSync(filename, 'utf8');
  for (const disallowed of [
    'firebase-admin', 'firebase-functions', 'initializeApp(',
    '.runTransaction(', '.collection(', 'tx.create(', 'tx.delete(',
    'setDoc(', 'updateDoc(', '.set(', 'onCall(', 'onSchedule(',
    'console.log(', 'console.error(', 'spawn(', 'writeFile(',
    'FieldValue.delete(', 'emulators:export',
  ]) {
    // Some prohibited API names appear only in the explanatory comments.
    const executable = source.split('\n').filter(line =>
      !line.trim().startsWith('//')).join('\n');
    assert.equal(executable.includes(disallowed), false, disallowed);
  }
});
