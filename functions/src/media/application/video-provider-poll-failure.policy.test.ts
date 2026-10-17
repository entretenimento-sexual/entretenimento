import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PROVIDER_POLL_HOLD_AFTER,
  PROVIDER_POLL_REVIEW_AFTER,
  PROVIDER_POLL_REVIEW_HOLD_AT,
  clearProviderPollFailures,
  isProviderPollReviewRequired,
  nextProviderPollFailure,
} from './video-provider-poll-failure.policy';

test('persistent HTTP 403/404 backs off, signals review and stops scheduled polling', () => {
  const now = 1_800_000_000_000;
  let state = {
    processingVersion: 'version-a',
    providerPollFailureVersion: null as string | null,
    providerPollFailureCount: 0,
  };
  let lastDue = now;
  for (let attempt = 1; attempt <= PROVIDER_POLL_HOLD_AFTER; attempt++) {
    const result = nextProviderPollFailure(state, now + attempt, false);
    assert.equal(result.providerPollFailureVersion, 'version-a');
    assert.equal(result.providerPollFailureCount, attempt);
    assert.equal(result.providerPollLastFailedAt, now + attempt);
    assert.equal(result.providerPollReviewRequired, attempt >= PROVIDER_POLL_REVIEW_AFTER);
    assert.ok(result.nextAttemptAt >= lastDue);
    lastDue = result.nextAttemptAt;
    state = { ...state, ...result };
  }
  assert.equal(lastDue, PROVIDER_POLL_REVIEW_HOLD_AT);
  assert.equal(nextProviderPollFailure(state, now + 100_000, false).nextAttemptAt,
    PROVIDER_POLL_REVIEW_HOLD_AT);
});

test('transient failures back off with a bounded retry interval', () => {
  const now = 1_800_000_000_000;
  const first = nextProviderPollFailure({
    processingVersion: 'v', providerPollFailureVersion: null,
    providerPollFailureCount: 0,
  }, now, true);
  assert.equal(first.nextAttemptAt, now + 9 * 60_000);
  const second = nextProviderPollFailure({ ...first, processingVersion: 'v' }, now, true);
  assert.equal(second.nextAttemptAt, now + 18 * 60_000);
  const seventh = nextProviderPollFailure({
    ...second, processingVersion: 'v', providerPollFailureCount: 6,
  }, now, true);
  assert.equal(seventh.nextAttemptAt, now + 6 * 60 * 60_000);
});

test('processing versions isolate counters and manual reconfirmation cannot repeat immediately', () => {
  const now = 1_800_000_000_000;
  const previous = {
    processingVersion: 'previous', providerPollFailureVersion: 'previous',
    providerPollFailureCount: 7,
  };
  const replaced = nextProviderPollFailure({
    ...previous, processingVersion: 'new',
  }, now, false);
  assert.equal(replaced.providerPollFailureCount, 1);
  const stalled = {
    state: 'PROCESSING' as const,
    externalJobName: 'projects/demo/locations/us-central1/jobs/test',
    processingVersion: 'new',
    ...replaced, providerPollReviewRequired: true,
  };
  assert.equal(isProviderPollReviewRequired(stalled), true);
  assert.equal(isProviderPollReviewRequired({
    ...stalled, providerPollReviewRequired: false,
  }), false);
  assert.equal(isProviderPollReviewRequired({
    ...stalled, processingVersion: 'other',
  }), false);
  assert.equal(isProviderPollReviewRequired({
    ...stalled, state: 'CANCEL_REQUESTED',
  }), false);
});

test('successful provider observation clears counters and review hold', () => {
  assert.deepEqual(clearProviderPollFailures(), {
    providerPollFailureVersion: null,
    providerPollFailureCount: 0,
    providerPollLastFailedAt: null,
    providerPollReviewRequired: false,
  });
});
