import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { VideoProcessingJob } from './video-processing-job';
import {
  cleanupCancelledImmutableInput,
  matchesImmutableCancellationObject,
  selectImmutableCancellationTarget,
} from './video-immutable-cancellation-cleanup.policy';

const generation = '90071992547409933';
const crc = 'AAAAAA==';
function job(): VideoProcessingJob {
  const ownerUid = 'user';
  const videoId = 'video';
  const processingVersion = 'v1';
  const sourceStoragePath = `users/${ownerUid}/uploads/videos/${videoId}-original.mp4`;
  const sizeBytes = 120_000;
  return {
    ownerUid, videoId, processingVersion, sourceStoragePath,
    sourceGeneration: generation, sourceSizeBytes: sizeBytes,
    sourceMimeType: 'video/mp4',
    sourceProbe: {
      processingVersion, sourceStoragePath,
      sourceGeneration: generation, sourceSizeBytes: sizeBytes,
      widthPixels: 1280, heightPixels: 720, durationMs: 10_000,
      embeddedRotationDegrees: 0,
      displayAspectNumerator: 16, displayAspectDenominator: 9,
      sampleAspectRatio: { numerator: 1, denominator: 1 },
      videoCodec: 'h264', hasAudio: false, audioCodec: null,
      checkedAt: 1_800_000_000_000,
    },
    immutableInput: {
      sourceStoragePath, sourceGeneration: generation,
      destinationStoragePath:
        `users/${ownerUid}/processed/video-transcoder-inputs/` +
        `${videoId}/${processingVersion}/source.mp4`,
      destinationGeneration: '90071992547409944',
      sizeBytes, crc32c: crc, reused: false,
    },
  } as unknown as VideoProcessingJob;
}
function object() {
  const j = job();
  return {
    generation: j.immutableInput!.destinationGeneration,
    size: String(j.sourceSizeBytes),
    crc32c: crc,
    contentType: j.sourceMimeType,
    metadata: {
      source: 'video-immutable-transcoder-input',
      processingVersion: j.processingVersion,
      sourceStoragePath: j.sourceStoragePath,
      sourceGeneration: j.sourceGeneration,
      sourceCrc32c: crc,
    },
  };
}
test('cleanup target is version scoped with exact string generation', () => {
  const target = selectImmutableCancellationTarget(job());
  assert.ok(target);
  assert.equal(target.generation, '90071992547409944');
  assert.equal(matchesImmutableCancellationObject(target, object()), true);
});
test('legacy cancellation requires no immutable deletion', async () => {
  const j = { ...job(), immutableInput: null };
  let called = false;
  assert.equal(await cleanupCancelledImmutableInput(j, {
    claimIsCurrent: async () => { called = true; return true; },
    readObject: async () => { called = true; return null; },
    deletePinned: async () => { called = true; },
  }), true);
  assert.equal(called, false);
});
test('stale state and lease forbid all GCS I/O', async () => {
  let called = false;
  assert.equal(await cleanupCancelledImmutableInput(job(), {
    claimIsCurrent: async () => false,
    readObject: async () => { called = true; return object(); },
    deletePinned: async () => { called = true; },
  }), false);
  assert.equal(called, false);
});
test('cleanup requires a second current-claim check before deletion', async () => {
  let checks = 0;
  let deleted = false;
  const result = await cleanupCancelledImmutableInput(job(), {
    claimIsCurrent: async () => ++checks === 1,
    readObject: async () => object(),
    deletePinned: async () => { deleted = true; },
  });
  assert.equal(result, false);
  assert.equal(checks, 2);
  assert.equal(deleted, false);
});
test('matching GCS generation deletes only the exact version', async () => {
  const calls: Array<[string, string]> = [];
  assert.equal(await cleanupCancelledImmutableInput(job(), {
    claimIsCurrent: async () => true,
    readObject: async () => object(),
    deletePinned: async (path, gen) => { calls.push([path, gen]); },
  }), true);
  assert.deepEqual(calls, [[job().immutableInput!.destinationStoragePath,
    '90071992547409944']]);
});
test('missing GCS object is idempotent but requires current claim', async () => {
  let calls = 0;
  assert.equal(await cleanupCancelledImmutableInput(job(), {
    claimIsCurrent: async () => { calls++; return true; },
    readObject: async () => null,
    deletePinned: async () => { throw new Error('unexpected delete'); },
  }), true);
  assert.equal(calls, 2);
});
test('conflicting generation and metadata fail closed without delete', async () => {
  for (const changed of [
    { generation: '90071992547409945' },
    { generation: Number(job().immutableInput!.destinationGeneration) },
    { crc32c: 'BBBBBB==' },
    { size: '123' },
    { contentType: 'video/webm' },
    { metadata: { ...object().metadata, processingVersion: 'replacement' } },
  ]) {
    let deleted = false;
    await assert.rejects(cleanupCancelledImmutableInput(job(), {
      claimIsCurrent: async () => true,
      readObject: async () => ({ ...object(), ...changed }),
      deletePinned: async () => { deleted = true; },
    }), /IMMUTABLE_CLEANUP_GENERATION_OR_PROVENANCE_CONFLICT/);
    assert.equal(deleted, false);
  }
});
test('corrupt persisted immutable identity is never silently skipped', () => {
  const j = job();
  assert.throws(() => selectImmutableCancellationTarget({
    ...j, immutableInput: { ...j.immutableInput!, crc32c: 'invalid' },
  }), /IMMUTABLE_CLEANUP_INVALID_SNAPSHOT/);
  assert.throws(() => selectImmutableCancellationTarget({
    ...j, immutableInput: { ...j.immutableInput!, destinationGeneration: '999999999999999999999999' },
  }), /IMMUTABLE_CLEANUP_INVALID_GENERATION/);
});
