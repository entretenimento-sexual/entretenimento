import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  canClaimVideoCleanupJob,
  VIDEO_CLEANUP_LEASE_MS,
  type VideoCleanupClaimableJob,
} from './video-cleanup-claim.policy';

const NOW = 1_800_000_000_000;

describe('video cleanup Firestore claim eligibility', () => {
  it('accepts a due, unleased retryable job', () => {
    assert.equal(canClaimVideoCleanupJob({ state: 'retryable', nextAttemptAt: NOW }, NOW), true);
  });

  it('rejects future work without incrementing its attempt count', () => {
    assert.equal(canClaimVideoCleanupJob({ state: 'retryable', nextAttemptAt: NOW + 1 }, NOW), false);
  });

  it('rejects active leases from concurrent invocations', () => {
    assert.equal(canClaimVideoCleanupJob({
      state: 'retryable', nextAttemptAt: NOW, leaseUntil: NOW + VIDEO_CLEANUP_LEASE_MS,
    }, NOW), false);
  });

  it('can reclaim expired lease after a worker disappears', () => {
    assert.equal(canClaimVideoCleanupJob({
      state: 'retryable', nextAttemptAt: NOW, leaseUntil: NOW - 1,
    }, NOW), true);
  });

  it('never claims manual-review dead letters', () => {
    assert.equal(canClaimVideoCleanupJob({ state: 'dead_letter', nextAttemptAt: NOW }, NOW), false);
  });

  it('never accidentally selects legacy jobs before migration', () => {
    assert.equal(canClaimVideoCleanupJob({ attempts: 1 } as VideoCleanupClaimableJob, NOW), false);
  });

  it('rejects malformed deadlines and leases', () => {
    assert.equal(canClaimVideoCleanupJob({ state: 'retryable', nextAttemptAt: 'now' }, NOW), false);
    assert.equal(canClaimVideoCleanupJob({
      state: 'retryable', nextAttemptAt: NOW, leaseUntil: 'not-a-time',
    }, NOW), false);
  });
});
