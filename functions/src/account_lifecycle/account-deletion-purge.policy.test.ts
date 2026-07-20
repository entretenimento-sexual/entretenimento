import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACCOUNT_DELETION_MAX_RETRY_MS,
  buildAccountDeletionRetrySchedule,
  buildPurgeCandidateReference,
  isAccountDeletionLeaseAvailable,
  isAccountDeletionRetryDue,
  normalizePurgeAttemptCount,
  sanitizePurgeError,
} from './account-deletion-purge.policy';

const NOW = 1_800_000_000_000;

test('retry schedule applies exponential backoff with a 24 hour cap', () => {
  assert.equal(
    buildAccountDeletionRetrySchedule({ attemptCount: 1, now: NOW }).delayMs,
    60 * 60 * 1_000
  );
  assert.equal(
    buildAccountDeletionRetrySchedule({ attemptCount: 2, now: NOW }).delayMs,
    2 * 60 * 60 * 1_000
  );
  assert.equal(
    buildAccountDeletionRetrySchedule({ attemptCount: 20, now: NOW }).delayMs,
    ACCOUNT_DELETION_MAX_RETRY_MS
  );
});

test('retry due respects the persisted next attempt timestamp', () => {
  assert.equal(isAccountDeletionRetryDue({}, NOW), true);
  assert.equal(
    isAccountDeletionRetryDue({ purgeNextAttemptAt: NOW + 1 }, NOW),
    false
  );
  assert.equal(
    isAccountDeletionRetryDue({ purgeNextAttemptAt: NOW }, NOW),
    true
  );
});

test('lease blocks other executions until expiration', () => {
  assert.equal(
    isAccountDeletionLeaseAvailable(
      { purgeLeaseOwner: 'run-a', purgeLeaseUntil: NOW + 1_000 },
      NOW,
      'run-b'
    ),
    false
  );
  assert.equal(
    isAccountDeletionLeaseAvailable(
      { purgeLeaseOwner: 'run-a', purgeLeaseUntil: NOW + 1_000 },
      NOW,
      'run-a'
    ),
    true
  );
  assert.equal(
    isAccountDeletionLeaseAvailable(
      { purgeLeaseOwner: 'run-a', purgeLeaseUntil: NOW },
      NOW,
      'run-b'
    ),
    true
  );
});

test('error sanitization never persists raw messages', () => {
  const sanitized = sanitizePurgeError({
    code: 'firestore/UNAVAILABLE',
    message: 'token=secret user@example.com',
  });

  assert.deepEqual(sanitized, {
    code: 'firestore/unavailable',
    category: 'firestore',
  });
  assert.equal(JSON.stringify(sanitized).includes('secret'), false);
});

test('candidate reference is deterministic and does not expose the uid', () => {
  const reference = buildPurgeCandidateReference('sensitive-user-1');

  assert.equal(reference.length, 16);
  assert.equal(reference, buildPurgeCandidateReference('sensitive-user-1'));
  assert.equal(reference.includes('sensitive-user-1'), false);
});

test('attempt normalization rejects invalid and negative values', () => {
  assert.equal(normalizePurgeAttemptCount('4'), 4);
  assert.equal(normalizePurgeAttemptCount(-3), 0);
  assert.equal(normalizePurgeAttemptCount('invalid'), 0);
});
