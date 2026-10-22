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

test('physical deletion delegates finalization to matching-identity transaction', () => {
  assert.match(source, /await finalizePhotoDeletionJob\(db, jobId, job\)/);
});

test('stale photo cleanup retry cannot mutate a replaced job or regress attempts', () => {
  assert.match(source, /async function recordDeletionAttemptFailure\(/);
  assert.match(source, /current\.get\('createdAt'\) !== job\.createdAt/);
  assert.match(source, /Number\(current\.get\('attempts'\) \?\? 0\) !== job\.attempts/);
  assert.match(source, /tx\.update\(jobRef, \{/);
});

test('photo upload registration checks existing deletion job in same transaction', () => {
  const upload = readFileSync(
    join(__dirname, '../../../src/media/application/register-private-photo-upload.handler.ts'),
    'utf8'
  );
  assert.match(upload, /const deletionJobRef = db\.collection\('media_photo_deletion_jobs'\)/);
  assert.match(upload, /transaction\.get\(deletionJobRef\)/);
  assert.match(upload, /if \(deletionJobSnap\.exists\)/);
  assert.match(upload, /A exclusão anterior desta foto ainda está em andamento/);
});

test('published asset cleanup is durable before publication is removed', () => {
  const stage = source.indexOf('stagePublishedPhotoAssetCleanup(tx, {');
  const remove = source.indexOf('tx.delete(publicationRef);');
  assert.ok(stage >= 0 && remove > stage);
  assert.match(source, /storagePath: currentPublicationData\?\.publishedStoragePath/);
});

test('published cleanup retries verify job identity before deleting or updating', () => {
  const cleanup = readFileSync(
    join(__dirname, '../../../src/media/application/published-photo-asset.service.ts'),
    'utf8'
  );
  const runner = cleanup.slice(cleanup.indexOf('export async function processPendingPublishedPhotoAssetCleanupJobs'));
  assert.match(runner, /current\.get\('createdAt'\) !== job\.createdAt/);
  assert.match(runner, /current\.get\('updatedAt'\) !== job\.updatedAt/);
  assert.match(runner, /current\.get\('attempts'\) !== job\.attempts/);
  assert.match(runner, /tx\.delete\(jobDoc\.ref\)/);
  assert.match(runner, /tx\.update\(jobDoc\.ref, \{/);
});

test('published cleanup invalid and retention paths use identity-guarded transactions', () => {
  const cleanup = readFileSync(
    join(__dirname, '../../../src/media/application/published-photo-asset.service.ts'),
    'utf8'
  );
  const runner = cleanup.slice(cleanup.indexOf('export async function processPendingPublishedPhotoAssetCleanupJobs'));
  const invalidStart = runner.indexOf('if (!storagePath) {');
  const invalid = runner.slice(invalidStart, runner.indexOf('try {', invalidStart));
  const retentionStart = runner.indexOf('if (await hasPublishedPhotoRetentionBlocker(job))');
  const retention = runner.slice(retentionStart, runner.indexOf('waitingRetention += 1'));
  for (const part of [invalid, retention]) {
    assert.match(part, /await db\.runTransaction\(async \(tx\) =>/);
    assert.match(part, /current\.get\('createdAt'\) !== job\.createdAt/);
    assert.match(part, /current\.get\('attempts'\) !== job\.attempts/);
    assert.match(part, /tx\.update\(jobDoc\.ref, \{/);
  }
});

test('published cleanup never purges unresolved dead letters by expiry', () => {
  const cleanup = readFileSync(
    join(__dirname, '../../../src/media/application/published-photo-asset.service.ts'),
    'utf8'
  );
  const runner = cleanup.slice(
    cleanup.indexOf('export async function processPendingPublishedPhotoAssetCleanupJobs')
  );
  assert.doesNotMatch(runner, /expiredDeadLetters|tx\\.delete\\(expiredDoc\\.ref\\)/);
  assert.match(runner, /deadLetterPurged: 0|const deadLetterPurged = 0/);
});

test('direct published cleanup preserves replacement jobs after physical deletion', () => {
  const cleanup = readFileSync(
    join(__dirname, '../../../src/media/application/published-photo-asset.service.ts'),
    'utf8'
  );
  const direct = cleanup.slice(
    cleanup.indexOf('export async function deletePublishedPhotoAssetOrQueue'),
    cleanup.indexOf('export async function processPendingPublishedPhotoAssetCleanupJobs')
  );
  assert.match(direct, /const existingCleanup = await cleanupRef\.get\(\)/);
  assert.match(direct, /current\.get\('createdAt'\) !== existingCleanup\.get\('createdAt'\)/);
  assert.match(direct, /current\.get\('updatedAt'\) !== existingCleanup\.get\('updatedAt'\)/);
  assert.match(direct, /tx\.delete\(cleanupRef\)/);
});

test('previously absent private photo is checked again before finalizing its deletion', () => {
  assert.match(source, /job\.storageGeneration === 'absent'/);
  assert.match(source, /file\(job\.storagePath\)\.exists\(\)/);
  assert.match(source, /Previously absent private photo now exists/);
});

test('published photo deletion fails closed on supplied invalid asset paths', () => {
  const cleanup = readFileSync(
    join(__dirname, '../../../src/media/application/published-photo-asset.service.ts'),
    'utf8'
  );
  assert.match(cleanup, /function resolvePublishedPhotoCleanupPath\(/);
  assert.match(cleanup, /value === null \|\| value === undefined \|\| value === ''/);
  assert.match(cleanup, /Caminho de foto publicada inválido; revisão manual necessária/);
  assert.match(cleanup, /const storagePath = resolvePublishedPhotoCleanupPath\(/);
  assert.match(cleanup, /export function stagePublishedPhotoAssetCleanup/);
  assert.match(cleanup, /export async function deletePublishedPhotoAssetOrQueue/);
});

test('missing-private-photo flow stages durable published cleanup with visibility removal', () => {
  const missing = source.slice(
    source.indexOf('if (!privatePhotoSnap.exists)'),
    source.indexOf('const privatePhoto = privatePhotoSnap.data()')
  );
  assert.match(missing, /const missingPhotoCleanup = await db\.runTransaction\(async \(tx\) =>/);
  assert.match(missing, /tx\.get\(privatePhotoRef\)/);
  assert.match(missing, /tx\.get\(publicationRef\)/);
  const stage = missing.indexOf('stagePublishedPhotoAssetCleanup(tx, {');
  const remove = missing.indexOf('tx.delete(publicationRef)');
  assert.ok(stage >= 0 && remove > stage);
  assert.match(missing, /if \(currentPrivate\.exists\)/);
  assert.match(missing, /if \(isModerationLockedPublication\(currentPublicationData\)/);
  assert.doesNotMatch(missing, /cleanupBatch\.commit\(\)/);
});
