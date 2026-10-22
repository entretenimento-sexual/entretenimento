import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(
  join(__dirname, '../../../src/media/application/delete-profile-video.handler.ts'),
  'utf8'
);

test('private video and poster generation captured before the deletion transaction', () => {
  assert.match(source, /const \[preflightVideo, preflightProcessing\] = await Promise\.all/);
  assert.match(source, /capturePrivateVideoGeneration\(preflightPaths\.privateVideoStoragePath\)/);
  assert.match(source, /capturePrivateVideoGeneration\(preflightPaths\.privatePosterStoragePath\)/);
  assert.match(source, /currentPaths\.privateVideoStoragePath !== preflightPaths\.privateVideoStoragePath/);
  assert.match(source, /currentPaths\.privatePosterStoragePath !== preflightPaths\.privatePosterStoragePath/);
  assert.match(source, /privateVideoStorageGeneration,/);
  assert.match(source, /privatePosterStorageGeneration,/);
});

test('private video deletion refuses jobs without a pinned generation', () => {
  assert.match(source, /Unpinned private video deletion; manual review required/);
  assert.match(source, /deleteGenerationPinnedVideoFile\(recordedGeneration,/);
  assert.match(source, /ifGenerationMatch: generation/);
  assert.match(source, /Previously absent private video asset now exists/);
});
