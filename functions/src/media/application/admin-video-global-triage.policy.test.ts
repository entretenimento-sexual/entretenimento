import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminTriageKey, compareAdminTriageJobs, projectAdminTriageJob,
  assessAdminTriageActivation, type AdminTriageCandidate,
  type AdminTriageActivationEvidence,
} from './admin-video-global-triage.policy';

const now = 1_800_000_000_000;
function candidate(jobId: string, override: Partial<AdminTriageCandidate> = {}):
  AdminTriageCandidate {
  return {
    jobId, state: 'PROCESSING', timestampEvidence: 'UPDATED',
    updatedAt: now - 20_000, ageMs: 20_000, stale: false,
    requiresProviderReview: false, providerPollReviewRequired: false,
    requiresOperationalAttention: false, unconfirmedSubmission: false,
    ...override,
  };
}

test('c18c critical items at the last ID outrank newer normal work', () => {
  const records = Array.from({ length: 9_000 }, (_, n) =>
    candidate('job-' + String(n).padStart(5, '0'), {
      updatedAt: now - n * 100,
      ageMs: n * 100,
    }));
  records.push(candidate('zz-overdue-cancellation', {
    state: 'CANCEL_REQUESTED', requiresOperationalAttention: true,
  }));
  records.push(candidate('zz-provider-review', { providerPollReviewRequired: true }));
  const firstIdPage = records.slice(0, 30);
  assert.equal(firstIdPage.some(x => x.requiresOperationalAttention), false);
  const sorted = [...records].sort(compareAdminTriageJobs);
  assert.deepEqual(sorted.slice(0, 2).map(x => x.jobId),
    ['zz-overdue-cancellation', 'zz-provider-review']);
  assert.equal(sorted.length, records.length);
  assert.deepEqual(records.map(x => x.jobId), [...records].map(x => x.jobId));
});

test('c18c priority is deterministic under tie, timestamps and legacy absence', () => {
  const a = candidate('a', { updatedAt: now - 30_000, ageMs: 30_000 });
  const b = candidate('b', { updatedAt: now - 30_000, ageMs: 30_000 });
  const noTimestamp = candidate('legacy', {
    timestampEvidence: 'UNVERIFIED', updatedAt: 0, ageMs: 0,
  });
  assert.equal(compareAdminTriageJobs(a, b), -1);
  assert.equal(compareAdminTriageJobs(b, a), 1);
  assert.equal(compareAdminTriageJobs(a, a), 0);
  assert.ok(compareAdminTriageJobs(noTimestamp, a) < 0);
  assert.deepEqual(adminTriageKey(noTimestamp),
    { tier: 1, since: 0, jobId: 'legacy' });
  assert.equal(adminTriageKey(candidate('failed', { state: 'FAILED' })).tier, 2);
  assert.equal(adminTriageKey(candidate('review', {
    state: 'FAILED', requiresProviderReview: true,
  })).tier, 0);
});

test('c18c projection omits terminal jobs, fences attempts, handles legacy', () => {
  assert.equal(projectAdminTriageJob('done', {
    state: 'SUCCEEDED', processingVersion: 'v1', updatedAt: now,
  }, now), null);
  assert.equal(projectAdminTriageJob('missing', {
    state: 'FAILED', updatedAt: now,
  }, now), null);
  const legacy = projectAdminTriageJob('legacy', {
    state: 'QUEUED', processingVersion: 'v1',
  }, now);
  assert.deepEqual(legacy, {
    adminTriageProjectionVersion: 1, adminTriageProcessingVersion: 'v1',
    adminTriageTier: 1, adminTriageSince: 0, adminTriageReevaluateAt: null,
  });
  const updated = projectAdminTriageJob('job', {
    state: 'FAILED', processingVersion: 'v2',
    lastErrorCode: 'SUBMISSION_UNCONFIRMED', updatedAt: now - 60_000,
  }, now);
  assert.equal(updated?.adminTriageProcessingVersion, 'v2');
  assert.equal(updated?.adminTriageTier, 0);
  assert.equal(updated?.adminTriageSince, now - 60_000);
});

test('c18c time-driven stale and cancellation tiers need recomputation', () => {
  const queued = {
    state: 'QUEUED' as const, processingVersion: 'v1',
    updatedAt: now - 19 * 60_000,
  };
  const before = projectAdminTriageJob('queued', queued, now);
  const after = projectAdminTriageJob('queued', queued, now + 2 * 60_000);
  assert.equal(before?.adminTriageTier, 5);
  assert.equal(before?.adminTriageReevaluateAt, queued.updatedAt + 20 * 60_000 + 1);
  assert.equal(after?.adminTriageTier, 3);
  const cancelled = {
    state: 'CANCEL_REQUESTED' as const, processingVersion: 'v1',
    cancelRequestedAt: now - 23 * 60 * 60_000, nextAttemptAt: now - 100,
    updatedAt: now,
  };
  assert.equal(projectAdminTriageJob('cancel', cancelled, now)?.adminTriageTier, 5);
  assert.equal(projectAdminTriageJob('cancel', cancelled, now)?.adminTriageReevaluateAt,
    now + 60 * 60_000);
  assert.equal(projectAdminTriageJob('cancel', cancelled,
    now + 2 * 60 * 60_000)?.adminTriageTier, 0);
});

test('c18c readiness remains blocked until independent global proofs exist', () => {
  const all: AdminTriageActivationEvidence = {
    deployedIndexReady: true, allActionableProjected: true,
    legacyCoverageVerified: true, writerVersionFencingVerified: true,
    dynamicReevaluationVerified: true, terminalDocumentsExcluded: true,
    concurrentCursorSafetyVerified: true, boundedReadBudgetVerified: true,
    globallyConsistentAuditVerified: true,
  };
  assert.deepEqual(assessAdminTriageActivation(all),
    { ready: true, blockedBy: [] });
  for (const key of Object.keys(all) as (keyof AdminTriageActivationEvidence)[]) {
    const result = assessAdminTriageActivation({ ...all, [key]: false });
    assert.equal(result.ready, false);
    assert.deepEqual(result.blockedBy, [key]);
  }
});
