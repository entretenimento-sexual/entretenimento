import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DIRECT_UNREAD_JOURNAL_RETENTION_MS,
  DIRECT_UNREAD_JOURNAL_STALE_MS,
  classifyDirectUnreadJournal,
} from './direct-unread-backfill-journal.policy';

describe('direct unread journal retention policy', () => {
  const now = Date.UTC(2026, 9, 13);

  it('never assumes stale RUNNING means terminated', () => {
    const current = classifyDirectUnreadJournal('RUNNING', now - 1_000, null, now);
    assert.equal(current.classification, 'RUNNING_RECENT');
    assert.equal(current.eligibleForPurge, false);
    const stale = classifyDirectUnreadJournal(
      'RUNNING', now - DIRECT_UNREAD_JOURNAL_STALE_MS, null, now
    );
    assert.equal(stale.classification, 'RUNNING_STALE_UNKNOWN');
    assert.equal(stale.eligibleForPurge, false);
  });

  it('prunes only records with validated terminal timestamps after retention', () => {
    for (const status of ['SUCCEEDED', 'FAILED']) {
      const expired = classifyDirectUnreadJournal(
        status, now - DIRECT_UNREAD_JOURNAL_RETENTION_MS - 1,
        now - DIRECT_UNREAD_JOURNAL_RETENTION_MS, now
      );
      assert.equal(expired.classification, status);
      assert.equal(expired.eligibleForPurge, true);
      const recent = classifyDirectUnreadJournal(status, now - 1_000, now - 500, now);
      assert.equal(recent.eligibleForPurge, false);
    }
  });

  it('blocks missing timestamps, clock skew and unexpected states', () => {
    for (const [status, updated, finished] of [
      ['SUCCEEDED', null, null],
      ['FAILED', now - 1_000, null],
      ['RUNNING', now + 1, null],
      ['SUCCEEDED', now - 1_000, now - 2_000],
      ['UNKNOWN', now - 1_000, now],
    ] as const) {
      const result = classifyDirectUnreadJournal(status, updated, finished, now);
      assert.equal(result.classification, 'INVALID');
      assert.equal(result.eligibleForPurge, false);
    }
  });
});
