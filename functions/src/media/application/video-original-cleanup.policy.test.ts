import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildVideoOriginalCleanupJob,
  mayDeletePublishedVideoOriginal,
  VIDEO_ORIGINAL_CLEANUP_GRACE_MS,
  videoOriginalCleanupJobId,
} from './video-original-cleanup.policy';

const uid = 'owner';
const id = 'vid1';
const original = `users/${uid}/uploads/videos/${id}-a.mp4`;
const processed = `users/${uid}/processed/videos/${id}/v1/final.mp4`;
const published = `users/${uid}/published/videos/${id}/assets/a1`;

function fixture() {
  const job = buildVideoOriginalCleanupJob({
    ownerUid: uid, videoId: id, sourceStoragePath: original,
    sourceGeneration: '90071992547409933', processedStoragePath: processed,
    publishedStoragePath: published, now: 1000,
  });
  assert.ok(job);
  return job;
}

test('creates a due-later cleanup job only for an exact owned immutable source', () => {
  const job = fixture();
  assert.equal(job.nextAttemptAt, 1000 + VIDEO_ORIGINAL_CLEANUP_GRACE_MS);
  assert.equal(job.sourceGeneration, '90071992547409933');
  assert.equal(videoOriginalCleanupJobId(uid, id).length, 64);
  assert.notEqual(videoOriginalCleanupJobId('a_b', 'c'),
    videoOriginalCleanupJobId('a', 'b_c'));
  for (const extra of [
    { sourceGeneration: null },
    { sourceGeneration: Number.MAX_SAFE_INTEGER + 1 },
    { sourceStoragePath: `users/${uid}/uploads/videos/other.mp4` },
    { processedStoragePath: `users/${uid}/processed/videos/${id}/` },
    { publishedStoragePath: `users/${uid}/published/videos/other/assets/a1` },
  ]) {
    assert.equal(buildVideoOriginalCleanupJob({ ...job, ...extra, now: 1000 }), null);
  }
});

test('deletion requires published approved asset and a completed exact processing job', () => {
  const job = fixture();
  const video = { ownerUid: uid, path: original,
    sourceGeneration: job.sourceGeneration, processedStoragePath: processed, status: 'ready' };
  const publication = { ownerUid: uid, videoId: id, isPublished: true,
    moderationStatus: 'APPROVED', sourceStoragePath: original,
    publishedStoragePath: published };
  const processing = { ownerUid: uid, videoId: id,
    state: 'SUCCEEDED', outputStoragePath: processed };
  assert.equal(mayDeletePublishedVideoOriginal(job, video, publication, processing), true);
  assert.equal(mayDeletePublishedVideoOriginal(job, video,
    { ...publication, reviewEvidenceRetention: 'PUBLISHED_ASSET_LOCKED' }, processing), false);
  assert.equal(mayDeletePublishedVideoOriginal(job, video,
    { ...publication, moderationStatus: 'FLAGGED' }, processing), false);
  assert.equal(mayDeletePublishedVideoOriginal(job, video,
    { ...publication, publishedStoragePath: published + '-changed' }, processing), false);
  assert.equal(mayDeletePublishedVideoOriginal(job,
    { ...video, sourceGeneration: '123' }, publication, processing), false);
  assert.equal(mayDeletePublishedVideoOriginal(job, video, publication,
    { ...processing, state: 'PROCESSING' }), false);
  assert.equal(mayDeletePublishedVideoOriginal(job, null, publication, processing), false);
});
