import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(
  join(__dirname, '../../../src/media/application/delete-profile-photo.handler.ts'),
  'utf8'
);

test('photo deletion stages job and visibility removal in the same transaction', () => {
  assert.match(source, /const staged = await db\.runTransaction\(async \(tx\) =>/);
  assert.match(source, /tx\.create\(jobRef, job\)/);
  assert.match(source, /tx\.delete\(publicationRef\)/);
  assert.match(source, /tx\.delete\(publicPhotoRef\)/);
  assert.doesNotMatch(source, /hideBatch\.set\(jobRef, job\)/);
});

test('duplicate photo deletion never overwrites a pending job or its retry history', () => {
  assert.match(source, /if \(existingJob\.exists\)/);
  assert.match(source, /existingJob\.get\('ownerUid'\) !== ownerUid/);
  assert.match(source, /existingJob\.get\('photoId'\) !== photoId/);
  assert.match(source, /existingJob\.get\('storagePath'\) !== storagePath/);
  assert.match(source, /if \(!staged\) return \{ photoId, cleanupPending: true \}/);
});

test('missing private photo does not acknowledge pending physical cleanup', () => {
  assert.match(source, /if \(!privatePhotoSnap\.exists\)/);
  assert.match(source, /if \(pendingJob\.exists\)/);
  assert.match(source, /return \{ photoId, cleanupPending: true \}/);
});
