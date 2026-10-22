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

test('physical deletion completion cannot erase a replaced cleanup job', () => {
  assert.match(source, /await db\.runTransaction\(async \(tx\) =>/);
  assert.match(source, /current\.get\('createdAt'\) !== job\.createdAt/);
  assert.match(source, /current\.get\('storagePath'\) !== job\.storagePath/);
  assert.match(source, /photo-deletion-job-identity-changed/);
  assert.match(source, /tx\.delete\(jobRef\)/);
});

test('stale photo cleanup retry cannot mutate a replaced job or regress attempts', () => {
  assert.match(source, /async function recordDeletionAttemptFailure\(/);
  assert.match(source, /current\.get\('createdAt'\) !== job\.createdAt/);
  assert.match(source, /Number\(current\.get\('attempts'\) \?\? 0\) !== job\.attempts/);
  assert.match(source, /tx\.update\(jobRef, \{/);
});
