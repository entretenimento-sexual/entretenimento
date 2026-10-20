import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';

import {
  createVideoTriageAuditSession,
  openVideoTriageAuditCheckpoint,
  reportVideoTriageAudit,
  sealVideoTriageAuditCheckpoint,
  settleVideoTriageAuditPage,
  videoTriageAuditCanRead,
  type VideoTriageAuditApproval,
  type VideoTriageAuditBudget,
} from './admin-video-triage-audit-session.policy';
import type {
  VideoTriageConcurrentAuditPage,
} from './admin-video-triage-evidence-audit.firestore';

const now = 1_800_000_000_000;
const secret = randomBytes(32);
const approval: VideoTriageAuditApproval = {
  approved: true, purpose: 'MANUAL_EMULATOR_TRIAGE_AUDIT',
  expectedProjectId: 'demo-entretenimento-video-reconciliation',
  expectedDatabaseId: '(default)',
};
const budget: VideoTriageAuditBudget = {
  pageSize: 1, maxPages: 9, maxDocuments: 9,
  maxDocumentReads: 27, maxDurationMs: 60_000, maxFailures: 1,
};

function start() {
  const created = createVideoTriageAuditSession(approval, budget, secret, now);
  const bound: VideoTriageAuditApproval = {
    ...approval, expectedSessionId: created.sessionId,
  };
  return {
    ...created, bound,
    ledger: openVideoTriageAuditCheckpoint(created.checkpoint, secret, bound),
  };
}

function emptyPage(state: VideoTriageConcurrentAuditPage['state']):
  VideoTriageConcurrentAuditPage {
  return {
    scope: 'PAGE_ONLY', consistency: 'BEST_EFFORT_NOT_SNAPSHOT',
    state, checkedAt: now, observed: 0,
    stableOnReread: 0, changedOnReread: 0, removedOnReread: 0,
    movedOnReread: 0,
    counts: {
      CURRENT: 0, MISSING_PROJECTION: 0, STALE_VERSION: 0,
      DIVERGENT: 0, TIME_DUE: 0, TERMINAL_RESIDUE: 0,
      UNVERSIONED: 0, TERMINAL_CLEAR: 0,
    }, hasMore: false, nextCursor: null, maxQueryReads: 2,
    maxPointReads: 0, maxDocumentReads: 2,
    maxWrites: 0, provesGlobalCoverage: false,
    concurrentCursorSafetyVerified: false,
  };
}

test('c18i HMAC binds immutable audit budget to project and exact session', () => {
  const { sessionId, checkpoint, bound, ledger } = start();
  assert.equal(ledger.sessionId, sessionId);
  assert.equal(ledger.projectId, approval.expectedProjectId);
  assert.equal(ledger.budget.maxDocumentReads, 27);
  assert.equal(ledger.nextLaneIndex, 0);
  assert.equal(ledger.lanes.length, 7);
  assert.throws(() => openVideoTriageAuditCheckpoint(
    checkpoint, randomBytes(32), bound));
  assert.throws(() => openVideoTriageAuditCheckpoint(
    checkpoint, secret, { ...bound, expectedProjectId: 'demo-another-project' }));
  assert.throws(() => openVideoTriageAuditCheckpoint(
    checkpoint, secret, { ...bound, expectedSessionId:
      'ba81a318-9737-4b58-bba5-7e7f4d026f20' }));
  const altered = checkpoint.slice(0, 15) + 'A' + checkpoint.slice(16);
  assert.throws(() => openVideoTriageAuditCheckpoint(altered, secret, bound));
  assert.throws(() => createVideoTriageAuditSession(approval,
    { ...budget, maxPages: 101 }, secret, now), RangeError);
  assert.throws(() => createVideoTriageAuditSession(approval,
    budget, randomBytes(16), now), RangeError);
  assert.throws(() => createVideoTriageAuditSession({
    ...approval, approved: false,
  } as unknown as VideoTriageAuditApproval, budget, secret, now));
});

test('c18i resume across seven lanes is never global snapshot proof', () => {
  const { ledger, bound } = start();
  let progress = ledger;
  for (let i = 0; i < 7; i++) {
    const lane = progress.lanes[progress.nextLaneIndex].state;
    progress = settleVideoTriageAuditPage(progress, now + i + 1,
      emptyPage(lane));
    const sealed = sealVideoTriageAuditCheckpoint(progress, secret);
    progress = openVideoTriageAuditCheckpoint(sealed, secret, bound);
    assert.equal(progress.pagesCompleted, i + 1);
  }
  const report = reportVideoTriageAudit(progress);
  assert.equal(report.lanesExamined, 7);
  assert.equal(report.pagesCompleted, 7);
  assert.equal(report.reservedDocumentReads, 21);
  assert.equal(report.status, 'LANES_EXAMINED');
  assert.equal(report.scope, 'SESSION_PARTIAL');
  assert.equal(report.globalCoverageVerified, false);
  assert.equal(report.concurrentCursorSafetyVerified, false);
  assert.equal(report.eligibleForIndependentReview, false);
  assert.equal(report.globalOrderingEnabled, false);
  assert.equal(videoTriageAuditCanRead(progress, now + 10).reason, 'FINISHED');
});

test('c18i cumulative reserve stops before over-budget read or expired clock', () => {
  const { ledger } = start();
  const constrained = { ...ledger, budget: { ...budget,
    maxPages: 1, maxDocumentReads: 3 } };
  const after = settleVideoTriageAuditPage(constrained, now + 1,
    emptyPage('QUEUED'));
  assert.equal(after.reservedDocumentReads, 3);
  assert.equal(after.status, 'STOPPED_BUDGET');
  assert.equal(videoTriageAuditCanRead(after, now + 2).allowed, false);
  assert.throws(() => settleVideoTriageAuditPage(after, now + 3,
    emptyPage('SUBMITTING')));
  assert.equal(videoTriageAuditCanRead(ledger, now + 60_001).reason,
    'EXPIRED');
  const failed = settleVideoTriageAuditPage(ledger, now + 1, null);
  assert.equal(failed.pagesAttempted, 1);
  assert.equal(failed.pagesCompleted, 0);
  assert.equal(failed.reservedDocumentReads, 3);
  assert.equal(failed.lastReadFailed, true);
  assert.equal(failed.status, 'PAUSED_FAILURE');
  assert.equal(failed.lanes[0].afterId, null);
  const secondFail = settleVideoTriageAuditPage(failed, now + 2, null);
  assert.equal(secondFail.status, 'STOPPED_BUDGET');
  assert.equal(secondFail.failedPages, 2);
  assert.equal(secondFail.reservedDocumentReads, 6);
});

test('c18i refuses mismatched lane and unsupported page evidence', () => {
  const { ledger } = start();
  assert.throws(() => settleVideoTriageAuditPage(ledger, now + 1,
    emptyPage('FAILED')));
  assert.throws(() => settleVideoTriageAuditPage(ledger, now + 1, {
    ...emptyPage('QUEUED'), maxWrites: 1,
  }));
  assert.throws(() => settleVideoTriageAuditPage(ledger, now + 1, {
    ...emptyPage('QUEUED'), observed: 2,
  }));
});
