import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVideoWorkOutcomeCounter } from './video-processing-outcomes.policy';

test('confirmed uploads and empty cycles have no job alerts', () => {
  const counts = createVideoWorkOutcomeCounter();
  assert.equal(counts.needsAttention(), false);
  counts.observe('SUBMISSION_CONFIRMED');
  counts.observe('RECOVERY_CONFIRMED');
  counts.observe('PROVIDER_NONTERMINAL');
  counts.observe('PROVIDER_SUCCEEDED_OBSERVED');
  assert.deepEqual(counts.metrics(), {
    submissionConfirmed: 1, recoveryConfirmed: 1,
    providerNonterminal: 1, providerSucceededObserved: 1,
  });
  assert.equal(counts.needsAttention(), false);
});

test('handled submission errors and ambiguous recovery require attention', () => {
  for (const outcome of [
    'SUBMISSION_UNCONFIRMED', 'SUBMISSION_RETRY', 'SUBMISSION_FAILED',
    'SUBMISSION_DEFERRED', 'RECOVERY_UNCONFIRMED', 'RECOVERY_POLL_ERROR',
  ] as const) {
    const counts = createVideoWorkOutcomeCounter();
    counts.observe(outcome);
    assert.equal(counts.needsAttention(), true, outcome);
    assert.equal(Object.values(counts.metrics()).reduce((a, b) => a + b, 0), 1);
  }
});

test('provider GET errors, manual review and terminal FAILED cannot be healthy', () => {
  for (const outcome of [
    'PROVIDER_POLL_ERROR', 'PROVIDER_REVIEW', 'PROVIDER_FAILED_OBSERVED',
  ] as const) {
    const counts = createVideoWorkOutcomeCounter();
    counts.observe(outcome);
    assert.equal(counts.needsAttention(), true, outcome);
  }
});

test('superseded and cancelled versions do not fabricate a provider failure', () => {
  const counts = createVideoWorkOutcomeCounter();
  counts.observe('PROCESSING_REPLACED');
  counts.observe('SUBMISSION_REPLACED');
  counts.observe('RECOVERY_REPLACED');
  assert.equal(counts.needsAttention(), false);
  assert.deepEqual(counts.metrics(), {
    processingReplaced: 1, submissionReplaced: 1, recoveryReplaced: 1,
  });
});
