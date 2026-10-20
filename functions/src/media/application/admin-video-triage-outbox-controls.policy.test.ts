import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assessVideoTriageOutboxCostWindow,
  assessVideoTriageOutboxRetentionPrerequisites,
  VIDEO_TRIAGE_MUTATION_OUTBOX_SCHEMA_VERSION,
  type VideoTriageOutboxBudgetLimits,
  type VideoTriageOutboxCostObservation,
} from './admin-video-triage-mutation-outbox.firestore';

const start = 1_800_000_000_000;
const baseline: VideoTriageOutboxCostObservation = {
  scope: 'OFFLINE_EMULATOR_OR_MANUAL_REPORT',
  windowStartMs: start,
  windowEndMs: start + 60 * 60_000,
  newEventDocuments: 10,
  sampledStoredBytes: 3_000,
  sampledDocuments: 10,
  retainedDocumentsAtEnd: 20,
};
const thresholds: VideoTriageOutboxBudgetLimits = {
  maxNewEventDocuments: 10,
  maxEventsPerHour: 10,
  maxSampledStoredBytes: 3_000,
  maxObservationHours: 1,
};

test('c18t bounded offline budget accepts boundary without production authority', () => {
  assert.equal(VIDEO_TRIAGE_MUTATION_OUTBOX_SCHEMA_VERSION, 1);
  const report = assessVideoTriageOutboxCostWindow(baseline, thresholds);
  assert.equal(report.status, 'WITHIN_OFFLINE_THRESHOLDS');
  assert.equal(report.eventWritesObserved, 10);
  assert.equal(report.eventsPerHourCeiling, 10);
  assert.equal(report.sampledStoredBytes, 3_000);
  assert.equal(report.productionCostVerified, false);
  assert.equal(report.globalCoverageVerified, false);
  assert.equal(report.cleanupAuthorized, false);
  assert.equal(report.globalOrderingEnabled, false);
});

test('c18t event growth, rate, sampled storage or oversized window trigger review', () => {
  const cases: VideoTriageOutboxCostObservation[] = [
    { ...baseline, newEventDocuments: 11 },
    { ...baseline, windowEndMs: start + 30 * 60_000 },
    { ...baseline, sampledStoredBytes: 3_001 },
    { ...baseline, windowEndMs: start + 2 * 60 * 60_000 },
  ];
  for (const sample of cases) {
    const report = assessVideoTriageOutboxCostWindow(sample, thresholds);
    assert.equal(report.status, 'EXCEEDS_OFFLINE_THRESHOLDS');
    assert.equal(report.cleanupAuthorized, false);
  }
});

test('c18t missing, invented or invalid limits never produce green budget', () => {
  assert.equal(assessVideoTriageOutboxCostWindow(
    baseline, null).status, 'MISSING_APPROVED_LIMITS');
  assert.equal(assessVideoTriageOutboxCostWindow(
    baseline, { ...thresholds, maxEventsPerHour: -1 }
  ).status, 'MISSING_APPROVED_LIMITS');
  assert.equal(assessVideoTriageOutboxCostWindow(
    baseline, { ...thresholds, maxObservationHours: 25 }
  ).status, 'MISSING_APPROVED_LIMITS');
  assert.equal(assessVideoTriageOutboxCostWindow(
    baseline, { ...thresholds, maxNewEventDocuments: NaN }
  ).status, 'MISSING_APPROVED_LIMITS');
});

test('c18t malformed timing, counts, and samples are inconclusive', () => {
  const invalid: VideoTriageOutboxCostObservation[] = [
    { ...baseline, windowEndMs: baseline.windowStartMs },
    { ...baseline, newEventDocuments: -1 },
    { ...baseline, sampledStoredBytes: Number.POSITIVE_INFINITY },
    { ...baseline, sampledDocuments: 21 },
    { ...baseline, retainedDocumentsAtEnd: -1 },
    { ...baseline, windowStartMs: 0 },
    { ...baseline, windowEndMs: Number.MAX_SAFE_INTEGER + 1 },
  ];
  for (const sample of invalid) {
    const report = assessVideoTriageOutboxCostWindow(sample, thresholds);
    assert.equal(report.status, 'INVALID_OBSERVATION');
    assert.equal(report.eventWritesObserved, null);
    assert.equal(report.cleanupAuthorized, false);
  }
});

test('c18t cost sample alone cannot confer real billing or writer completeness', () => {
  const sample = assessVideoTriageOutboxCostWindow({
    ...baseline, newEventDocuments: 0, sampledStoredBytes: 0,
    sampledDocuments: 0, retainedDocumentsAtEnd: 0,
  }, thresholds);
  assert.equal(sample.status, 'WITHIN_OFFLINE_THRESHOLDS');
  assert.equal(sample.productionCostVerified, false);
  assert.equal(sample.globalCoverageVerified, false);
  assert.equal(sample.cleanupAuthorized, false);
});

test('c18t all retention evidence flags still do not authorize deletion', () => {
  const missing = assessVideoTriageOutboxRetentionPrerequisites({
    completeWriterCoverageVerified: false,
    immutableGlobalSequenceVerified: false,
    independentConsumerCheckpointVerified: false,
    tombstoneHorizonApproved: false,
    privacyAndLegalRetentionApproved: false,
  });
  assert.equal(missing.status, 'RETAIN_AND_REVIEW');
  assert.equal(missing.unresolvedRequirements.length, 5);
  assert.equal(missing.cleanupAuthorized, false);
  const claimed = assessVideoTriageOutboxRetentionPrerequisites({
    completeWriterCoverageVerified: true,
    immutableGlobalSequenceVerified: true,
    independentConsumerCheckpointVerified: true,
    tombstoneHorizonApproved: true,
    privacyAndLegalRetentionApproved: true,
  });
  assert.equal(claimed.unresolvedRequirements.length, 0);
  assert.equal(claimed.status, 'RETAIN_AND_REVIEW');
  assert.equal(claimed.cleanupAuthorized, false);
  assert.equal(claimed.productionCostVerified, false);
  assert.equal(claimed.globalCoverageVerified, false);
});
