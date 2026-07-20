import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cursorForAccountDeletionOperation,
  mapAccountDeletionOperation,
  matchesAccountDeletionOperationFilter,
  normalizeAccountDeletionOperationsRequest,
} from './account-deletion-operations.model';

test('normalizes deletion operations request with safe defaults', () => {
  assert.deepEqual(normalizeAccountDeletionOperationsRequest(null), {
    filter: 'attention',
    limit: 20,
    cursor: null,
  });

  assert.deepEqual(
    normalizeAccountDeletionOperationsRequest({
      filter: 'completed',
      limit: 500,
      cursor: {
        updatedAt: 1_800_000_000_000,
        reference: 'ABCDEF0123456789',
      },
    }),
    {
      filter: 'completed',
      limit: 50,
      cursor: {
        updatedAt: 1_800_000_000_000,
        reference: 'abcdef0123456789',
      },
    }
  );
});

test('maps tombstone to sanitized operational projection', () => {
  const item = mapAccountDeletionOperation('sensitive-user-uid', {
    uid: 'sensitive-user-uid',
    emailHash: 'email-hash-that-must-not-leak',
    purgePhase: 'retry_scheduled',
    source: 'self',
    purgeAttemptCount: 4,
    dataRetentionPolicyVersion: 11,
    authDeletionStatus: 'success',
    firestoreDeletionStatus: 'pending',
    dataDeletionStatus: 'blocked',
    dataDeletionCompletedDomains: ['public_profile', 'auth_identity'],
    dataDeletionBlockers: [
      'owned_media_and_storage',
      'unknown-domain',
      'owned_media_and_storage',
    ],
    purgeNextAttemptAt: 1_800_000_100_000,
    purgeRetryDelayMs: 7_200_000,
    purgeLeaseUntil: 1_800_000_010_000,
    purgeLastErrorCode: 'storage/object-not-found',
    purgeLastErrorCategory: 'storage',
    purgeLastErrorPhase: 'data_cleanup',
    deletionRequestedAt: 1_799_999_000_000,
    deletedAt: 1_800_000_000_000,
    purgeAfter: 1_800_000_000_000,
    updatedAt: 1_800_000_000_100,
    dataDeletionDomainProgress: [{ errorMessage: 'private detail' }],
  });

  assert.equal(item.reference.length, 16);
  assert.notEqual(item.reference, 'sensitive-user-uid');
  assert.equal(item.status, 'blocked');
  assert.equal(item.attemptCount, 4);
  assert.equal(item.completedDomainCount, 2);
  assert.deepEqual(item.blockingDomains, ['owned_media_and_storage']);
  assert.equal(item.lastErrorCode, 'storage/object-not-found');

  const serialized = JSON.stringify(item);
  assert.equal(serialized.includes('sensitive-user-uid'), false);
  assert.equal(serialized.includes('email-hash-that-must-not-leak'), false);
  assert.equal(serialized.includes('private detail'), false);
});

test('classifies attention, progress, completed and pending states', () => {
  const retry = mapAccountDeletionOperation('retry-user', {
    purgePhase: 'retry_scheduled',
    purgeNextAttemptAt: 1_800_000_100_000,
    updatedAt: 1_800_000_000_000,
  });
  const progress = mapAccountDeletionOperation('progress-user', {
    purgePhase: 'data_cleanup',
    updatedAt: 1_800_000_000_001,
  });
  const completed = mapAccountDeletionOperation('completed-user', {
    purgePhase: 'completed',
    firestoreDeletionStatus: 'success',
    updatedAt: 1_800_000_000_002,
  });
  const pending = mapAccountDeletionOperation('pending-user', {
    purgePhase: 'pending',
    updatedAt: 1_800_000_000_003,
  });

  assert.equal(retry.status, 'retry_scheduled');
  assert.equal(progress.status, 'in_progress');
  assert.equal(completed.status, 'completed');
  assert.equal(pending.status, 'pending');
  assert.equal(
    matchesAccountDeletionOperationFilter(retry, 'attention'),
    true
  );
  assert.equal(
    matchesAccountDeletionOperationFilter(progress, 'attention'),
    false
  );
  assert.equal(
    matchesAccountDeletionOperationFilter(completed, 'completed'),
    true
  );
});

test('builds cursor only when projection has a valid timestamp', () => {
  const valid = mapAccountDeletionOperation('cursor-user', {
    updatedAt: 1_800_000_000_000,
  });
  const invalid = mapAccountDeletionOperation('cursor-user-2', {
    updatedAt: null,
  });

  assert.deepEqual(cursorForAccountDeletionOperation(valid), {
    updatedAt: 1_800_000_000_000,
    reference: valid.reference,
  });
  assert.equal(cursorForAccountDeletionOperation(invalid), null);
});
