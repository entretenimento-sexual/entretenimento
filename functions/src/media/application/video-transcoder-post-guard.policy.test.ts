import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VideoProcessingJob } from './video-processing-job';
import {
  canSubmitCurrentTranscoderJob,
  submitAfterTranscoderPostGuard,
} from './video-transcoder-post-guard.policy';

const now = 1_800_000_000_000;
function fixture(): VideoProcessingJob {
  return {
    ownerUid: 'owner',
    videoId: 'video',
    provider: 'GOOGLE_TRANSCODER',
    processingVersion: '1800000000000-version',
    sourceStoragePath: 'users/owner/uploads/videos/video-original.mp4',
    sourceGeneration: '90071992547409930',
    sourceMimeType: 'video/mp4',
    sourceSizeBytes: 100_000,
    outputPrefix: 'users/owner/processed/videos/video/1800000000000-version/',
    state: 'SUBMITTING',
    attempts: 1,
    nextAttemptAt: now - 1_000,
    leaseUntil: now + 60_000,
    cancelRequestedAt: null,
    externalJobName: null,
  } as VideoProcessingJob;
}
function privateVideo(job: VideoProcessingJob) {
  return { path: job.sourceStoragePath, sourceGeneration: job.sourceGeneration };
}
test('post guard authorizes only current SUBMITTING lease and private generation', () => {
  const observed = fixture();
  assert.equal(canSubmitCurrentTranscoderJob(
    { ...observed }, observed, privateVideo(observed), now, false
  ), true);
});
test('post guard rejects cancellation, expired lease, newer attempt and provider ID', () => {
  const observed = fixture();
  for (const change of [
    { state: 'CANCEL_REQUESTED' as const },
    { cancelRequestedAt: now },
    { leaseUntil: now },
    { leaseUntil: now + 30_000 },
    { attempts: 2 },
    { externalJobName: 'projects/p/locations/l/jobs/j' },
    { state: 'PROCESSING' as const },
  ]) {
    assert.equal(canSubmitCurrentTranscoderJob(
      { ...observed, ...change }, observed, privateVideo(observed), now, false
    ), false);
  }
});
test('post guard rejects source replacement, version and generation drift', () => {
  const observed = fixture();
  for (const change of [
    { processingVersion: 'replacement' },
    { sourceGeneration: '90071992547409931' },
    { sourceStoragePath: 'users/owner/uploads/videos/video-replacement.mp4' },
    { sourceSizeBytes: 50_000 },
    { outputPrefix: 'users/owner/processed/videos/video/another/' },
  ]) {
    assert.equal(canSubmitCurrentTranscoderJob(
      { ...observed, ...change }, observed, privateVideo(observed), now, false
    ), false);
  }
  assert.equal(canSubmitCurrentTranscoderJob(
    observed, observed, { ...privateVideo(observed), sourceGeneration: '1' }, now, false
  ), false);
  assert.equal(canSubmitCurrentTranscoderJob(observed, observed, null, now, false), false);
});
test('post guard fails closed for missing immutable preflight when required', () => {
  const observed = fixture();
  assert.equal(canSubmitCurrentTranscoderJob(
    observed, observed, privateVideo(observed), now, true
  ), false);
});
test('post guard allows genuinely legacy jobs without generations', () => {
  const observed = { ...fixture(), sourceGeneration: undefined };
  assert.equal(canSubmitCurrentTranscoderJob(
    observed, observed, { path: observed.sourceStoragePath }, now, true
  ), true);
});
test('post callback cannot POST after denial or pending cancellation', async () => {
  let posts = 0;
  let release!: (allowed: boolean) => void;
  const promise = submitAfterTranscoderPostGuard(
    () => new Promise<boolean>(resolve => { release = resolve; }),
    async () => { posts++; return { name: 'billable' }; }
  );
  release(false);
  assert.equal(await promise, null);
  assert.equal(posts, 0);
  const confirmed = await submitAfterTranscoderPostGuard(
    async () => true,
    async () => { posts++; return { name: 'billable' }; }
  );
  assert.deepEqual(confirmed, { name: 'billable' });
  assert.equal(posts, 1);
});
test('post guard propagates authorization failures without a provider call', async () => {
  let posts = 0;
  await assert.rejects(
    submitAfterTranscoderPostGuard(
      async () => { throw new Error('firestore unavailable'); },
      async () => { posts++; return true; }
    ), /firestore unavailable/
  );
  assert.equal(posts, 0);
});
