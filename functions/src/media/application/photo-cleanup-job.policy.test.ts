import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PHOTO_CLEANUP_DEAD_LETTER_RETENTION_MS,
  PHOTO_CLEANUP_MAX_ATTEMPTS,
  PHOTO_CLEANUP_RETENTION_RECHECK_MS,
  PHOTO_CLEANUP_RETRY_BASE_MS,
  PHOTO_CLEANUP_RETRY_MAX_MS,
  nextPhotoCleanupRetry,
  photoCleanupRetentionRecheckAt,
} from './photo-cleanup-job.policy';

test('photo cleanup retry starts with bounded exponential backoff', () => {
  const now = 1_000_000;
  const first = nextPhotoCleanupRetry(0, now);

  assert.equal(first.state, 'retryable');
  assert.equal(first.attempts, 1);
  assert.equal(first.nextAttemptAt, now + PHOTO_CLEANUP_RETRY_BASE_MS);
  assert.equal(first.deadLetterExpiresAt, null);

  const later = nextPhotoCleanupRetry(7 - 1, now);
  assert.equal(later.state, 'retryable');
  assert.ok(
    (later.nextAttemptAt ?? 0) - now <= PHOTO_CLEANUP_RETRY_MAX_MS
  );
});

test('photo cleanup becomes dead-letter at the configured attempt ceiling', () => {
  const now = 2_000_000;
  const decision = nextPhotoCleanupRetry(
    PHOTO_CLEANUP_MAX_ATTEMPTS - 1,
    now
  );

  assert.equal(decision.state, 'dead_letter');
  assert.equal(decision.attempts, PHOTO_CLEANUP_MAX_ATTEMPTS);
  assert.equal(decision.nextAttemptAt, null);
  assert.equal(
    decision.deadLetterExpiresAt,
    now + PHOTO_CLEANUP_DEAD_LETTER_RETENTION_MS
  );
});

test('photo retention blocker receives a slower recheck window', () => {
  const now = 3_000_000;
  assert.equal(
    photoCleanupRetentionRecheckAt(now),
    now + PHOTO_CLEANUP_RETENTION_RECHECK_MS
  );
});
