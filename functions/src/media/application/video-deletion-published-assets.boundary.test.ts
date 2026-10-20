import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// Architectural fence: published assets must pass the per-path Firestore
// reference check instead of being deleted by a blind Storage prefix sweep.
const source = readFileSync(
  join(__dirname, '../../../src/media/application/delete-profile-video.handler.ts'),
  'utf8'
);

const transaction = readFileSync(
  join(__dirname, '../../../src/media/application/video-profile-deletion-commit.firestore.ts'),
  'utf8'
);

test('profile-video deletion never sweeps published storage by prefix', () => {
  assert.doesNotMatch(source, /deletePublishedAssetsByPrefix|publishedVideoPrefix/);
  assert.match(source, /await cleanupPublishedAssets\(job\)/);
  assert.match(source, /deletePublishedVideoAssetOrQueueWithResult\(/);
  assert.match(source, /if \(publishedOutcome === 'BLOCKED'\)/);
  assert.match(source, /return publishedOutcome === 'QUEUED_FOR_RETRY'/);
});

test('profile-video deletion has a single transactional queue entrypoint', () => {
  assert.match(source, /await commitProfileVideoDeletionRequest\(db,/);
  assert.match(transaction, /transaction\.create\(deletionJobRef/);
  assert.match(transaction, /retireVideoIdentityInTransaction\(/);
  assert.match(transaction, /stageVideoTriageMutationInTransaction\(/);
  assert.doesNotMatch(source, /removalBatch\.commit\(\)/);
  assert.match(source, /claimVideoDeletionJob</);
  assert.match(source, /settleVideoDeletionJob\(/);
  assert.match(source, /await processVideoDeletionJob\(jobRef\)/);
  assert.match(source, /await processVideoDeletionJob\(candidate\.ref\)/);
  assert.match(source, /where\('nextAttemptAt', '<=', now\)/);
  assert.doesNotMatch(source, /FieldValue\.increment|await jobRef\.delete\(\)/);
});
