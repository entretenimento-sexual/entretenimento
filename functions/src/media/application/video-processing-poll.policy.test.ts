import assert from 'node:assert/strict';
import test from 'node:test';

import {
  nextVideoProcessingPollAt,
  providerObservationChanged,
  isCurrentVideoProcessingAttempt,
} from './video-processing-poll.policy';

test('poll scheduling distinguishes recent and long-running processing', () => {
  const now = 1_800_000_000_000;
  assert.equal(nextVideoProcessingPollAt({
    createdAt: now - 10 * 60_000,
    submittedAt: now - 5 * 60_000,
  }, now), now + 9 * 60_000);
  assert.equal(nextVideoProcessingPollAt({
    createdAt: now - 60 * 60_000,
    submittedAt: now - 30 * 60_000,
  }, now), now + 14 * 60_000);
  assert.equal(nextVideoProcessingPollAt({
    createdAt: now - 40 * 60_000,
    submittedAt: null,
  }, now), now + 14 * 60_000);
});

test('unchanged provider status does not reset the stale-job clock', () => {
  const job = { providerState: 'RUNNING', lastErrorCode: null, lastError: null };
  assert.equal(providerObservationChanged(job, 'RUNNING'), false);
  assert.equal(providerObservationChanged(job, 'PENDING'), true);
  assert.equal(providerObservationChanged({
    ...job,
    lastErrorCode: 'TRANSIENT_ERROR',
  }, 'RUNNING'), true);
  assert.equal(providerObservationChanged({
    ...job,
    lastError: 'Previous error',
  }, 'RUNNING'), true);
});

test('stale video-provider responses cannot override cancellation or newer jobs', () => {
  const observed = {
    processingVersion: 'original',
    externalJobName: 'projects/demo/jobs/original',
  };
  const current = { ...observed, state: 'PROCESSING' as const };
  assert.equal(isCurrentVideoProcessingAttempt(current, observed), true);
  assert.equal(isCurrentVideoProcessingAttempt({
    ...current, state: 'CANCEL_REQUESTED',
  }, observed), false);
  assert.equal(isCurrentVideoProcessingAttempt({
    ...current, processingVersion: 'retry',
  }, observed), false);
  assert.equal(isCurrentVideoProcessingAttempt({
    ...current, externalJobName: 'projects/demo/jobs/other',
  }, observed), false);
});
