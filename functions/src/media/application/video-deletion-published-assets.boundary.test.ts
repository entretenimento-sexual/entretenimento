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

test('profile-video deletion never sweeps published storage by prefix', () => {
  assert.doesNotMatch(source, /deletePublishedAssetsByPrefix|publishedVideoPrefix/);
  assert.match(source, /await cleanupPublishedAssets\(job\)/);
  assert.match(source, /deletePublishedVideoAssetOrQueue\(/);
});
