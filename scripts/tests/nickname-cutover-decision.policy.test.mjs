import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateNicknameCutoverDecision } from '../maintenance/nickname-cutover-decision.policy.mjs';
import { CUTOVER_FLAGS } from '../maintenance/nickname-cutover-inventory.policy.mjs';

const NOW = Date.parse('2026-11-02T12:10:00.000Z');
const HOUR = 3_600_000;
function hourCoverage(count = 720) {
  const start = Date.parse('2026-10-03T12:00:00.000Z');
  return Array.from({ length: count }, (_, i) => ({
    hourStart: new Date(start + i * HOUR).toISOString(),
    dataWriteMonitoringActive: true,
    acceptedWriteCoverageComplete: true,
    deniedWriteCoverageComplete: true,
    clientAttributionComplete: true,
    registrationCompletionPathsCovered: true,
    nicknameIndexPathsCovered: true,
    legacyCompletionWriteAttempts: 0,
    unattributedCompletionWriteAttempts: 0,
  }));
}

const timestamps = {
  schemaVersion: 2,
  environment: 'LIVE',
  startedAt: '2026-11-02T12:00:00.000Z',
  completedAt: '2026-11-02T12:05:00.000Z',
};
const ready = {
  now: NOW,
  inventory: {
    ...timestamps, projectId: 'prod-project', mode: 'READ_ONLY',
    truncated: false, scannedUsers: 250, incompleteUsers: 20,
    completedUsers: 230, ready: 220, notPublic: 10, review: 0,
    flags: Object.fromEntries(CUTOVER_FLAGS.map(flag => [flag, 0])),
  },
  indexScan: {
    ...timestamps, projectId: 'prod-project', mode: 'DRY_RUN',
    truncated: false, scanned: 230, candidate: 0, already: 230,
    invalid: 0, conflict: 0, applied: 0, changedDuringTransaction: 0,
  },
  rollout: {
    projectId: 'prod-project', callablesDeployed: true,
    appCheckVerified: true, verifiedAdultAndLegalFlowTested: true,
    clientVersionFloorEnforced: true,
    zeroLegacyWritesObserved: true, socialAndEmailRegistrationTested: true,
    rollbackTested: true, supportAndPrivacyReviewed: true,
    nicknameIndexReadPrivacyReviewed: true, securityApproved: true,
    legacyObservationDays: 30, clientVersionFloor: '2026.11.1',
    legacyClientObservation: {
      schemaVersion: 1, projectId: 'prod-project',
      sourceKind: 'REVIEWED_SERVER_TELEMETRY',
      evidenceReference: 'internal-audit/2026-11-02',
      startedAt: '2026-10-03T12:00:00.000Z',
      completedAt: '2026-11-02T12:00:00.000Z',
      collectedAt: '2026-11-02T12:06:00.000Z',
      coverageComplete: true, attributionComplete: true,
      deniedWriteCoverageComplete: true,
      legacyCompletionWriteAttempts: 0,
      unattributedCompletionWriteAttempts: 0,
      hourlyCoverage: hourCoverage(),
    },
  },
};

test('absence of real evidence defaults to NO_GO', () => {
  const result = evaluateNicknameCutoverDecision();
  assert.equal(result.status, 'NO_GO');
  assert.equal(result.deploymentAuthorized, false);
  assert.ok(result.reasons.includes('MISSING_READ_ONLY_INVENTORY'));
});
test('even a complete candidate is not deployment authorization', () => {
  assert.deepEqual(evaluateNicknameCutoverDecision(ready), {
    status: 'REVIEW_READY', deploymentAuthorized: false, reasons: [],
  });
});
test('unmigrated nickname reservations block cutover', () => {
  const actual = evaluateNicknameCutoverDecision({
    ...ready, indexScan: { ...ready.indexScan, candidate: 12 },
  });
  assert.equal(actual.status, 'NO_GO');
  assert.ok(actual.reasons.includes('INDEX_CANDIDATE_REQUIRES_REVIEW'));
});
test('legacy clients still writing block cutover', () => {
  const r = evaluateNicknameCutoverDecision({
    ...ready, rollout: { ...ready.rollout,
      zeroLegacyWritesObserved: false, legacyObservationDays: 7 },
  });
  assert.equal(r.status, 'NO_GO');
  assert.ok(r.reasons.includes('MISSING_EVIDENCE_zeroLegacyWritesObserved'));
  assert.ok(r.reasons.includes('INSUFFICIENT_LEGACY_CLIENT_OBSERVATION'));
});
test('partial scan and mismatched projects are blocking', () => {
  const r = evaluateNicknameCutoverDecision({
    ...ready,
    inventory: { ...ready.inventory, truncated: true, projectId: 'other' },
  });
  assert.equal(r.status, 'NO_GO');
  assert.ok(r.reasons.includes('INVENTORY_NOT_EXHAUSTIVE'));
  assert.ok(r.reasons.includes('MISMATCHED_PROJECTS'));
});
test('privacy and safety sign-offs remain explicit', () => {
  const r = evaluateNicknameCutoverDecision({
    ...ready, rollout: { ...ready.rollout,
      nicknameIndexReadPrivacyReviewed: false, securityApproved: false },
  });
  assert.equal(r.status, 'NO_GO');
  assert.ok(r.reasons.includes('MISSING_EVIDENCE_nicknameIndexReadPrivacyReviewed'));
  assert.ok(r.reasons.includes('MISSING_EVIDENCE_securityApproved'));
});

test('old or malformed scan reports fail closed despite zero conflicts', () => {
  const stale = evaluateNicknameCutoverDecision({
    ...ready, inventory: {
      ...ready.inventory, completedAt: '2026-10-30T12:00:00.000Z',
    },
  });
  assert.equal(stale.status, 'NO_GO');
  assert.ok(stale.reasons.includes('INVALID_OR_STALE_INVENTORY'));
  const noSchema = evaluateNicknameCutoverDecision({
    ...ready, indexScan: {
      ...ready.indexScan, schemaVersion: undefined,
    },
  });
  assert.ok(noSchema.reasons.includes('INVALID_OR_STALE_INDEX_SCAN'));
});
test('inventory summaries must reconcile exactly and include every flag', () => {
  const bad = evaluateNicknameCutoverDecision({
    ...ready, inventory: {
      ...ready.inventory, incompleteUsers: 0,
      flags: {},
    },
  });
  assert.ok(bad.reasons.includes('INVENTORY_COUNTERS_INCONSISTENT'));
  assert.ok(bad.reasons.includes('INVENTORY_FLAG_COVERAGE_MISSING'));
});
test('missing index states cannot be masked with inconsistent totals', () => {
  const result = evaluateNicknameCutoverDecision({
    ...ready, indexScan: {
      ...ready.indexScan, already: 100,
    },
  });
  assert.equal(result.status, 'NO_GO');
  assert.ok(result.reasons.includes('INDEX_COUNTERS_INCONSISTENT'));
});

test('a legacy observation boolean and day count alone never pass', () => {
  const r = evaluateNicknameCutoverDecision({
    ...ready, rollout: { ...ready.rollout, legacyClientObservation: undefined },
  });
  assert.equal(r.status, 'NO_GO');
  assert.ok(r.reasons.includes('MISSING_VALID_LEGACY_OBSERVATION'));
});

test('observation window is calculated, recent and tied to the project', () => {
  for (const invalid of [
    { startedAt: '2026-10-31T12:00:00.000Z' },
    { completedAt: '2026-11-01T11:00:00.000Z' },
    { projectId: 'another-project' },
  ]) {
    const r = evaluateNicknameCutoverDecision({
      ...ready, rollout: { ...ready.rollout, legacyClientObservation: {
        ...ready.rollout.legacyClientObservation, ...invalid,
      } },
    });
    assert.equal(r.status, 'NO_GO');
  }
});

test('telemetry gaps, denied-write blindness and unknown writes fail closed', () => {
  for (const invalid of [
    { coverageComplete: false },
    { attributionComplete: false },
    { deniedWriteCoverageComplete: false },
    { legacyCompletionWriteAttempts: 1 },
    { unattributedCompletionWriteAttempts: 1 },
  ]) {
    const r = evaluateNicknameCutoverDecision({
      ...ready, rollout: { ...ready.rollout, legacyClientObservation: {
        ...ready.rollout.legacyClientObservation, ...invalid,
      } },
    });
    assert.equal(r.status, 'NO_GO');
  }
});

test('emulator reports cannot be promoted into a production review', () => {
  for (const key of ['inventory', 'indexScan']) {
    const r = evaluateNicknameCutoverDecision({
      ...ready, [key]: { ...ready[key], environment: 'EMULATOR' },
    });
    assert.equal(r.status, 'NO_GO');
    assert.ok(r.reasons.some(reason => reason.startsWith('INVALID_OR_STALE_')));
  }
});

test('full 30 day hourly continuity is required even when summary flags are true', () => {
  const r = evaluateNicknameCutoverDecision({
    ...ready, rollout: { ...ready.rollout, legacyClientObservation: {
      ...ready.rollout.legacyClientObservation, hourlyCoverage: undefined,
    } },
  });
  assert.equal(r.status, 'NO_GO');
  assert.ok(r.reasons.includes('LEGACY_HOURLY_COVERAGE_MISSING'));
});

test('missing one hour, duplicate hour and delayed source health all block', () => {
  for (const hourlyCoverage of [
    hourCoverage(719),
    hourCoverage().map((row, i) => i === 100
      ? { ...row, hourStart: new Date(Date.parse(row.hourStart) - HOUR).toISOString() }
      : row),
    hourCoverage().map((row, i) => i === 120
      ? { ...row, deniedWriteCoverageComplete: false }
      : row),
    hourCoverage().map((row, i) => i === 120
      ? { ...row, clientAttributionComplete: false }
      : row),
  ]) {
    const r = evaluateNicknameCutoverDecision({
      ...ready, rollout: { ...ready.rollout, legacyClientObservation: {
        ...ready.rollout.legacyClientObservation, hourlyCoverage,
      } },
    });
    assert.equal(r.status, 'NO_GO');
    assert.ok(r.reasons.some(reason => reason.startsWith('LEGACY_HOURLY_')));
  }
});

test('hourly incidents, counter mismatch and PII-shaped fields fail closed', () => {
  for (const hourlyCoverage of [
    hourCoverage().map((row, i) => i === 200
      ? { ...row, legacyCompletionWriteAttempts: 1 } : row),
    hourCoverage().map((row, i) => i === 200
      ? { ...row, unattributedCompletionWriteAttempts: 1 } : row),
    hourCoverage().map((row, i) => i === 200
      ? { ...row, uid: 'PRIVATE' } : row),
  ]) {
    const r = evaluateNicknameCutoverDecision({
      ...ready, rollout: { ...ready.rollout, legacyClientObservation: {
        ...ready.rollout.legacyClientObservation, hourlyCoverage,
      } },
    });
    assert.equal(r.status, 'NO_GO');
    assert.ok(r.reasons.some(reason => reason.startsWith('LEGACY_HOURLY_')));
  }
});
