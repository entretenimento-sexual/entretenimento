import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

// This contract must stay aligned with the production composite indexes.
// A bounded state-only query can repeatedly return not-yet-due jobs and starve
// eligible uploads or expired submission leases.
const scheduler = readFileSync(
  resolve(__dirname, '../../../src/media/application/video-processing.handler.ts'),
  'utf8'
);
const indexConfig = JSON.parse(readFileSync(
  resolve(__dirname, '../../../../firestore.indexes.json'),
  'utf8'
)) as {
  indexes: Array<{
    collectionGroup: string;
    queryScope: string;
    fields: Array<{ fieldPath: string; order: string }>;
  }>;
};

function assertCompositeIndex(dueField: string): void {
  assert.ok(indexConfig.indexes.some(index =>
    index.collectionGroup === 'media_video_processing_jobs'
    && index.queryScope === 'COLLECTION'
    && index.fields[0]?.fieldPath === 'state'
    && index.fields[0]?.order === 'ASCENDING'
    && index.fields[1]?.fieldPath === dueField
    && index.fields[1]?.order === 'ASCENDING'
  ), 'Missing composite index for state + ' + dueField);
}

test('queued video jobs query due timestamps before applying the batch limit', () => {
  assert.match(scheduler,
    /\.where\('state', '==', 'QUEUED'\)\s*\.where\('nextAttemptAt', '<=', now\)\s*\.orderBy\('nextAttemptAt', 'asc'\)\s*\.limit\(SUBMISSION_BATCH_SIZE\)/
  );
  assertCompositeIndex('nextAttemptAt');
});

test('submission recovery only selects expired leases before the batch limit', () => {
  assert.match(scheduler,
    /\.where\('state', '==', 'SUBMITTING'\)\s*\.where\('leaseUntil', '<=', now\)\s*\.orderBy\('leaseUntil', 'asc'\)\s*\.limit\(SUBMISSION_BATCH_SIZE\)/
  );
  assertCompositeIndex('leaseUntil');
});
