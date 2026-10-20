import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import {
  createVideoTriageAuditSession, openVideoTriageAuditCheckpoint,
  sealVideoTriageAuditCheckpoint, type VideoTriageAuditApproval,
  type VideoTriageAuditLedger,
} from './admin-video-triage-audit-session.policy';
import { validateVideoTriageAuditSession } from './admin-video-triage-audit-journal.firestore';

const key = randomBytes(32);
const at = 1_800_000_000_000;
const approval: VideoTriageAuditApproval = {
  approved: true, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT',
  expectedProjectId: 'demo-entretenimento-video-reconciliation',
  expectedDatabaseId: '(default)',
};

function fixture() {
  const start = createVideoTriageAuditSession(approval, {
    pageSize: 2, maxPages: 3, maxDocuments: 6,
    maxDocumentReads: 15, maxDurationMs: 120_000, maxFailures: 1,
  }, key, at);
  const bound = { ...approval, expectedSessionId: start.sessionId };
  const ledger = openVideoTriageAuditCheckpoint(start.checkpoint, key, bound);
  return { bound, ledger };
}

function checked(
  ledger: VideoTriageAuditLedger,
  bound: VideoTriageAuditApproval,
  reservation: number
) {
  return validateVideoTriageAuditSession(
    sealVideoTriageAuditCheckpoint(ledger, key), key, bound, reservation);
}

test('c18l pristine session is bounded but never global or billable proof', () => {
  const { ledger, bound } = fixture();
  const r = checked(ledger, bound, 0);
  assert.equal(r.consistency, 'CONSISTENT');
  assert.equal(r.cost, 'NOT_MEASURED');
  assert.equal(r.coverage, 'NOT_PROVEN');
  assert.equal(r.globalCoverageVerified, false);
  assert.equal(r.concurrentCursorSafetyVerified, false);
  assert.equal(r.productionCostVerified, false);
  assert.equal(r.globalOrderingEnabled, false);
  assert.equal(r.limits.maxJobReadsPerPage, 5);
  assert.equal(r.limits.maxJournalOperationsPerPage, 9);
  assert.equal(r.limits.maxJournalOperations, 27);
});

test('c18l reserved reads and journal operations must match every claim', () => {
  const { ledger, bound } = fixture();
  const state = {
    ...ledger, pagesAttempted: 2, pagesCompleted: 1,
    reservedDocumentReads: 10, documentsObserved: 2,
  };
  const valid = checked(state, bound, 18);
  assert.equal(valid.consistency, 'CONSISTENT');
  assert.equal(valid.limits.combinedReservationUpperBound, 28);
  assert.equal(checked(state, bound, 9).consistency, 'INCONSISTENT');
  assert.equal(checked(state, bound, 19).consistency, 'INCONSISTENT');
  const broken = { ...state, reservedDocumentReads: 9 };
  assert.equal(checked(broken, bound, 18).consistency, 'INCONSISTENT');
});

test('c18l concurrent moves are not mistaken for verified coverage', () => {
  const { ledger, bound } = fixture();
  const changed = {
    ...ledger, pagesAttempted: 1, pagesCompleted: 1,
    reservedDocumentReads: 5, changedOnReread: 1,
    movedOnReread: 1,
  };
  const result = checked(changed, bound, 9);
  assert.equal(result.consistency, 'CONSISTENT');
  assert.equal(result.coverage, 'CONCURRENT_CHANGES_OBSERVED');
  assert.ok(result.blockingReasons.includes(
    'NO_GLOBAL_SNAPSHOT_OR_CROSS_LANE_RECONCILIATION'));
});

test('c18l emulator metering is reviewed, never proof of production costs', () => {
  const { ledger, bound } = fixture();
  const measurement = {
    source: 'EMULATOR_INSTRUMENTATION' as const,
    jobQueryReads: 0, jobPointReads: 0,
    journalDocumentReads: 1, journalDocumentWrites: 1,
    transactionRetries: 0, recoveryReads: 0,
    statusReads: 1, registrationOperations: 2,
  };
  const empty = sealVideoTriageAuditCheckpoint(ledger, key);
  const reviewed = validateVideoTriageAuditSession(
    empty, key, bound, 0, measurement);
  assert.equal(reviewed.cost, 'MEASUREMENT_REVIEW');
  assert.equal(reviewed.productionCostVerified, false);
  assert.equal(validateVideoTriageAuditSession(
    empty, key, bound, 0, { ...measurement, recoveryReads: 5 }
  ).cost, 'INCONSISTENT');
  assert.throws(() => validateVideoTriageAuditSession(
    empty, randomBytes(32), bound, 0, measurement));
});
