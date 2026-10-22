import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(
  join(__dirname, '../../../src/media/application/delete-profile-video.handler.ts'),
  'utf8'
);

test('video deletion uses exact private paths and a version-specific processed prefix', () => {
  assert.doesNotMatch(source, /privateVideoPrefix\(|privatePosterPrefix\(|processedVideoPrefix\(/);
  assert.doesNotMatch(source, /deleteFilesByPrefix\(private/);
  assert.match(source, /deleteFilesByPrefix\(job\.processedOutputPrefix\)/);
  assert.match(source, /deleteVideoStoragePrefixBounded\(/);
  assert.match(source, /deletePinnedPrivateVideoAsset\(\s*job\.privateVideoStoragePath/);
  assert.match(source, /deletePinnedPrivateVideoAsset\(\s*job\.privatePosterStoragePath/);
  assert.match(source, /ifGenerationMatch: generation/);
  assert.doesNotMatch(source, /\.delete\(\{ ignoreNotFound: true \}\)/);
});
