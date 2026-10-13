import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DIRECT_UNREAD_MAX_COMMITTED_WRITES,
  DIRECT_UNREAD_MAX_ESTIMATED_READS,
  estimateDirectUnreadBackfillBudget,
} from './direct-unread-backfill-budget.policy';

describe('direct unread backfill workload budget', () => {
  it('bounds both optimistic work and transactional retries', () => {
    const one = estimateDirectUnreadBackfillBudget(1);
    assert.equal(one.estimatedReadsNoRetry, 23);
    assert.equal(one.estimatedReadsWithRetries, 53);
    assert.equal(one.maxCheckpointProjectionWrites, 4);
    assert.equal(one.maxJournalWrites, 3);
    assert.equal(one.maxCommittedWrites, 7);
    const hundred = estimateDirectUnreadBackfillBudget(100);
    assert.equal(hundred.estimatedReadsNoRetry, 11111);
    assert.equal(hundred.estimatedReadsWithRetries, 32723);
    assert.equal(hundred.maxCheckpointProjectionWrites, 400);
    assert.equal(hundred.maxJournalWrites, 12);
    assert.equal(hundred.maxCommittedWrites, DIRECT_UNREAD_MAX_COMMITTED_WRITES);
    assert.ok(hundred.estimatedReadsWithRetries < DIRECT_UNREAD_MAX_ESTIMATED_READS);
    assert.equal(hundred.billingEstimateOnly, true);
  });

  it('rejects empty, oversized, noninteger and nonfinite workloads', () => {
    for (const count of [0, -1, 101, 1000, 1.5, NaN, Infinity]) {
      assert.throws(() => estimateDirectUnreadBackfillBudget(count));
    }
  });
});
