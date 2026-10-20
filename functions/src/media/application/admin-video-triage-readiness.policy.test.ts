import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateVideoTriageReadiness, matchesVideoTriageIndexManifest,
  VIDEO_TRIAGE_GATE_FRESHNESS_MS,
  type VideoTriageReadinessEvidence,
} from './admin-video-triage-readiness.policy';

const now = 1_800_000_000_000;
const fields = (names: string[]) =>
  names.map(fieldPath => ({ fieldPath, order: 'ASCENDING' }));
const indexEvidence: NonNullable<VideoTriageReadinessEvidence['indexes']> = {
  source: 'FIRESTORE_ADMIN_API', environment: 'PRODUCTION',
  observedAt: now,
  indexes: [
    { collectionGroup: 'media_video_processing_jobs',
      queryScope: 'COLLECTION', state: 'READY',
      fields: fields(['adminTriageTier', 'adminTriageSince', '__name__']) },
    { collectionGroup: 'media_video_processing_jobs',
      queryScope: 'COLLECTION', state: 'READY',
      fields: fields(['adminTriageReevaluateAt', '__name__']) },
  ],
};

const fullReport: VideoTriageReadinessEvidence = {
  indexes: indexEvidence,
  coverage: {
    scope: 'GLOBAL_CONSISTENT', observedAt: now,
    completeStates: ['QUEUED', 'SUBMITTING', 'PROCESSING', 'FAILED',
      'CANCEL_REQUESTED', 'SUCCEEDED', 'CANCELLED'],
    fullReadCompleted: true, reconciledConcurrentMoves: true,
    actionableMissing: 0, versionMismatches: 0, overdueProjections: 0,
    terminalResidue: 0, unversionedLegacy: 0,
  },
  temporalDriver: {
    source: 'OPERATIONAL_CYCLES', observedAt: now, active: true,
    consecutiveSuccesses: 3, lastSuccessfulAt: now - 60_000,
    oldestUnprocessedLagMs: 60_000, failedCycles: 0,
  },
  cursors: {
    observedAt: now, globalSnapshotPinned: true,
    testedUnderConcurrentChanges: true, duplicateCount: 0, skippedCount: 0,
  },
  budgets: {
    observedAt: now, maxPageSize: 20, maxQueryReadsPerPage: 23,
    maxTransactionReadsPerPage: 40, maxWritesPerPage: 20,
    maxTransactionAttempts: 2,
  },
  writers: {
    observedAt: now, stateVersionFencingVerified: true,
    sameVersionConcurrentWritesVerified: true,
    cancellationAndTerminalGuardsVerified: true,
  },
};

test('c18g missing, partial or declared-only evidence fails closed', () => {
  const absent = evaluateVideoTriageReadiness(null, now);
  assert.equal(absent.phase, 'BLOCKED');
  assert.equal(absent.blockedBy.length, 9);
  assert.equal(absent.activationAuthorized, false);
  assert.equal(absent.globalOrderingEnabled, false);
  const declaration = evaluateVideoTriageReadiness({
    indexes: { ...indexEvidence, source: 'DECLARATION' },
    coverage: { ...fullReport.coverage!, scope: 'PAGE_ONLY' },
  }, now);
  assert.ok(declaration.blockedBy.includes('deployedIndexReady'));
  assert.ok(declaration.blockedBy.includes('globallyConsistentAuditVerified'));
  assert.ok(declaration.blockedBy.includes('allActionableProjected'));
});

test('c18g index READY reported only for both exact composite definitions', () => {
  assert.equal(matchesVideoTriageIndexManifest(indexEvidence.indexes), true);
  for (const bad of [
    indexEvidence.indexes.slice(0, 1),
    indexEvidence.indexes.map(x => ({ ...x, state: 'CREATING' })),
    indexEvidence.indexes.map(x => ({ ...x, queryScope: 'COLLECTION_GROUP' })),
    indexEvidence.indexes.map(x => ({ ...x, fields: [...x.fields].reverse() })),
  ]) assert.equal(matchesVideoTriageIndexManifest(bad), false);
  for (const bad of [
    { ...indexEvidence, source: 'EMULATOR' as const },
    { ...indexEvidence, environment: 'EMULATOR' as const },
    { ...indexEvidence, observedAt: now - VIDEO_TRIAGE_GATE_FRESHNESS_MS - 1 },
  ]) assert.equal(evaluateVideoTriageReadiness({
    ...fullReport, indexes: bad,
  }, now).checks.deployedIndexReady, false);
});

test('c18g external reports may request review but never enable global sort', () => {
  const ready = evaluateVideoTriageReadiness(fullReport, now);
  assert.deepEqual(ready.blockedBy, []);
  assert.equal(ready.phase, 'REQUIRES_MANUAL_PRODUCTION_APPROVAL');
  assert.equal(ready.eligibleForIndependentReview, true);
  assert.equal(ready.evidenceAuthority, 'UNVERIFIED_OPERATOR_INPUT');
  assert.equal(ready.activationAuthorized, false);
  assert.equal(ready.globalOrderingEnabled, false);
});

test('c18g all individual failure modes stop independent review', () => {
  const changes: VideoTriageReadinessEvidence[] = [
    { ...fullReport, coverage: { ...fullReport.coverage!,
      completeStates: ['QUEUED'], fullReadCompleted: false } },
    { ...fullReport, coverage: { ...fullReport.coverage!,
      actionableMissing: 1, terminalResidue: 1, unversionedLegacy: 1 } },
    { ...fullReport, coverage: { ...fullReport.coverage!,
      versionMismatches: 1, overdueProjections: 1 } },
    { ...fullReport, temporalDriver: { ...fullReport.temporalDriver!,
      active: false, failedCycles: 1 } },
    { ...fullReport, temporalDriver: { ...fullReport.temporalDriver!,
      oldestUnprocessedLagMs: 1_000_000 } },
    { ...fullReport, cursors: { ...fullReport.cursors!,
      globalSnapshotPinned: false, skippedCount: 1 } },
    { ...fullReport, budgets: { ...fullReport.budgets!,
      maxQueryReadsPerPage: 24, maxTransactionAttempts: 3 } },
    { ...fullReport, writers: { ...fullReport.writers!,
      sameVersionConcurrentWritesVerified: false } },
    { ...fullReport, coverage: { ...fullReport.coverage!,
      observedAt: now - VIDEO_TRIAGE_GATE_FRESHNESS_MS - 1 } },
  ];
  for (const report of changes) {
    const result = evaluateVideoTriageReadiness(report, now);
    assert.equal(result.phase, 'BLOCKED');
    assert.ok(result.blockedBy.length >= 1);
    assert.equal(result.activationAuthorized, false);
  }
  assert.throws(() => evaluateVideoTriageReadiness(null, 0), RangeError);
});
