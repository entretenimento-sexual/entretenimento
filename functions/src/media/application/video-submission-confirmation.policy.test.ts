import assert from 'node:assert/strict';
import test from 'node:test';

import { decideMissingVideoSubmission } from './video-submission-confirmation.policy';

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
