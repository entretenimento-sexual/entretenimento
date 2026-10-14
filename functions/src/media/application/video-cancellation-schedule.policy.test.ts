import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cancellationNeedsReview,
  isCurrentCancellationClaim,
  nextCancellationRetryAt,
} from './video-cancellation-schedule.policy';

test('cancellation retry delays are bounded to 30min, 2h and 24h', () => {
  const now = 1_800_000_000_000;
  assert.equal(nextCancellationRetryAt(1, now), now + 30 * 60_000);
  assert.equal(nextCancellationRetryAt(2, now), now + 2 * 60 * 60_000);
  assert.equal(nextCancellationRetryAt(3, now), now + 24 * 60 * 60_000);
  assert.equal(nextCancellationRetryAt(99, now), now + 24 * 60 * 60_000);
});

test('unknown provider and repeated failures require administrative review', () => {
  assert.equal(cancellationNeedsReview(1, 'CANCELLATION_UNCONFIRMED'), true);
  assert.equal(cancellationNeedsReview(1, 'TEMPORARY'), false);
  assert.equal(cancellationNeedsReview(3, 'TEMPORARY'), true);
});

test('cancellation fencing rejects a newer claim for the same version', () => {
  const started = {
    state: 'CANCEL_REQUESTED' as const,
    processingVersion: 'same-version',
    ownerUid: 'uid',
    videoId: 'vid',
    nextAttemptAt: 100,
  };
  assert.equal(isCurrentCancellationClaim(started as never, started as never), true);
  assert.equal(isCurrentCancellationClaim({
    ...started, nextAttemptAt: 200,
  } as never, started as never), false);
  assert.equal(isCurrentCancellationClaim({
    ...started, state: 'PROCESSING',
  } as never, started as never), false);
});
