import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const src = (file: string) => readFileSync(
  join(__dirname, '../../../src/media/application', file), 'utf8'
);

test('registration stores exact original generation from GCS metadata', () => {
  const register = src('register-private-video-upload.handler.ts');
  assert.match(register, /generation: normalizeGcsGeneration\(metadata\.generation\)/);
  assert.match(register, /sourceGeneration: videoMetadata\.generation/);
});

test('publication enqueues cleanup in the same fenced Firestore transaction', () => {
  const publication = src('video-publication-commit.firestore.ts');
  assert.match(publication, /buildVideoOriginalCleanupJob\(/);
  assert.match(publication, /transaction\.create\(cleanupRef, originalCleanup\)/);
  assert.match(publication, /transaction\.set\(publicationRef, publicationPatch/);
});

test('only the exact video original can be deleted after lease and GCS generation checks', () => {
  const worker = src('cleanup-published-video-originals.handler.ts');
  const existingScheduler = src('delete-profile-video.handler.ts');
  assert.match(existingScheduler, /processPendingVideoOriginalCleanupJobs\(\)/);
  assert.match(worker, /mayDeletePublishedVideoOriginal\(/);
  assert.match(worker, /publishedFile\.exists\(\)/);
  assert.match(worker, /lease\.get\('leaseToken'\) !== token/);
  assert.match(worker, /deleteGenerationPinnedVideoFile\(job\.sourceGeneration/);
  assert.match(worker, /ifGenerationMatch: generation/);
  assert.doesNotMatch(worker, /privatePosterStoragePath/);
});
