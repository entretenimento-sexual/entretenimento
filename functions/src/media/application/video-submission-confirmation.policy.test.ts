import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideMissingVideoSubmission,
  canAttachSubmittedProviderJob,
} from './video-submission-confirmation.policy';

test('ambiguous create never returns QUEUED or authorizes a second POST', () => {
  const now = 1_800_000_000_000;
  const first = decideMissingVideoSubmission({}, now);
  assert.equal(first.state, 'SUBMITTING');
  assert.equal(first.submissionLookupMisses, 1);
  assert.equal(first.leaseUntil, now + 15 * 60_000);
  assert.equal(first.lastErrorCode, 'SUBMISSION_LOOKUP_PENDING');

  const second = decideMissingVideoSubmission({
    submissionLookupMisses: first.submissionLookupMisses,
  }, now);
  assert.equal(second.leaseUntil, now + 60 * 60_000);

  const last = decideMissingVideoSubmission({
    submissionLookupMisses: second.submissionLookupMisses,
  }, now);
  assert.equal(last.state, 'SUBMITTING');
  assert.equal(last.leaseUntil, null);
  assert.equal(last.lastErrorCode, 'SUBMISSION_UNCONFIRMED');
  assert.equal(last.submissionLookupMisses, 3);
  assert.equal(decideMissingVideoSubmission({
    submissionLookupMisses: last.submissionLookupMisses,
  }, now).leaseUntil, null);
});

test('legacy and corrupt lookup counters use a conservative first miss', () => {
  assert.equal(decideMissingVideoSubmission({ submissionLookupMisses: -1 }, 0).submissionLookupMisses, 1);
  assert.equal(decideMissingVideoSubmission({ submissionLookupMisses: NaN }, 0).submissionLookupMisses, 1);
});

test('provider job binding refuses stale versions, replaced IDs and lease races', () => {
  const observed = {
    processingVersion: 'version-1',
    attempts: 1,
    sourceStoragePath: 'users/u/uploads/videos/video-source.mp4',
    leaseUntil: 900,
  };
  const base = {
    ...observed,
    state: 'SUBMITTING' as const,
    externalJobName: null,
  };
  assert.equal(canAttachSubmittedProviderJob(base, observed, 'jobs/one'), true);
  assert.equal(canAttachSubmittedProviderJob({
    ...base, leaseUntil: 901,
  }, observed, 'jobs/one'), false);
  assert.equal(canAttachSubmittedProviderJob({
    ...base, externalJobName: 'jobs/other',
  }, observed, 'jobs/one'), false);
  assert.equal(canAttachSubmittedProviderJob({
    ...base, processingVersion: 'version-2',
  }, observed, 'jobs/one'), false);
  assert.equal(canAttachSubmittedProviderJob({
    ...base, attempts: 2,
  }, observed, 'jobs/one'), false);
  assert.equal(canAttachSubmittedProviderJob({
    ...base, sourceStoragePath: 'users/u/uploads/videos/other.mp4',
  }, observed, 'jobs/one'), false);
});

test('late submission response cannot overwrite a cancellation provider ID', () => {
  const observed = {
    processingVersion: 'version-1',
    attempts: 1,
    sourceStoragePath: 'users/u/uploads/videos/video-source.mp4',
    leaseUntil: 900,
  };
  const cancelling = {
    ...observed,
    state: 'CANCEL_REQUESTED' as const,
    leaseUntil: null,
    externalJobName: 'jobs/already-confirmed',
  };
  assert.equal(canAttachSubmittedProviderJob(
    cancelling, observed, 'jobs/different'
  ), false);
  assert.equal(canAttachSubmittedProviderJob(
    cancelling, observed, 'jobs/already-confirmed'
  ), true);
  assert.equal(canAttachSubmittedProviderJob({
    ...cancelling, state: 'FAILED',
  }, observed, 'jobs/already-confirmed'), false);
});

test('recovery binds a provider ID only to the same PROCESSING attempt', () => {
  const observed = {
    processingVersion: 'version-processing',
    attempts: 1,
    sourceStoragePath: 'users/u/uploads/videos/video-source.mp4',
    leaseUntil: null,
  };
  const processing = {
    ...observed,
    state: 'PROCESSING' as const,
    externalJobName: null,
  };

  assert.equal(canAttachSubmittedProviderJob(
    processing, observed, 'jobs/recovered'
  ), true);
  assert.equal(canAttachSubmittedProviderJob({
    ...processing, externalJobName: 'jobs/existing',
  }, observed, 'jobs/recovered'), false);
  assert.equal(canAttachSubmittedProviderJob({
    ...processing, state: 'FAILED',
  }, observed, 'jobs/recovered'), false);
  assert.equal(canAttachSubmittedProviderJob({
    ...processing, processingVersion: 'version-replaced',
  }, observed, 'jobs/recovered'), false);
});
