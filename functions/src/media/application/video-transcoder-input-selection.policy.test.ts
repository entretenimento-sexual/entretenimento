import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { VideoProcessingJob } from './video-processing-job';
import {
  buildImmutableTranscoderInputPath,
  matchesPersistedImmutableInput,
  selectTranscoderInputSource,
} from './video-immutable-input.policy';

const SOURCE_GENERATION = '90071992547409933';
const DESTINATION_GENERATION = '90071992547409936';
const SIZE = 100_000;
const CRC32C = 'AAAAAA==';

function jobFixture(): VideoProcessingJob {
  const job = {
    ownerUid: 'testOwner',
    videoId: 'testVideo',
    processingVersion: '1800000000000-0123-4567',
    sourceStoragePath: 'users/testOwner/uploads/videos/testVideo-original.mp4',
    sourceGeneration: SOURCE_GENERATION,
    sourceMimeType: 'video/mp4',
    sourceSizeBytes: SIZE,
    state: 'QUEUED',
  } as VideoProcessingJob;
  job.sourceProbe = {
    processingVersion: job.processingVersion,
    sourceStoragePath: job.sourceStoragePath,
    sourceGeneration: SOURCE_GENERATION,
    sourceSizeBytes: SIZE,
    widthPixels: 1920,
    heightPixels: 1080,
    durationMs: 15_000,
    embeddedRotationDegrees: 0,
    displayAspectNumerator: 1920,
    displayAspectDenominator: 1080,
    sampleAspectRatio: { numerator: 1, denominator: 1 },
    videoCodec: 'h264',
    hasAudio: false,
    audioCodec: null,
    checkedAt: 1800000000000,
  };
  job.immutableInput = {
    sourceStoragePath: job.sourceStoragePath,
    sourceGeneration: SOURCE_GENERATION,
    destinationStoragePath: buildImmutableTranscoderInputPath(job),
    destinationGeneration: DESTINATION_GENERATION,
    sizeBytes: SIZE,
    crc32c: CRC32C,
    reused: false,
  };
  return job;
}

test('source selection: flag OFF stays on the original path, ignoring the opt-in snapshot', () => {
  const job = jobFixture();
  assert.deepEqual(selectTranscoderInputSource(job, false), {
    mode: 'legacy',
    sourceStoragePath: job.sourceStoragePath,
  });
});

test('source selection: truly legacy jobs remain compatible with flag ON', () => {
  const job = jobFixture();
  delete job.sourceGeneration;
  delete job.sourceProbe;
  delete job.immutableInput;
  assert.deepEqual(selectTranscoderInputSource(job, true), {
    mode: 'legacy',
    sourceStoragePath: job.sourceStoragePath,
  });
});

test('source selection: valid opt-in pins exact path and generation without loss of precision', () => {
  const job = jobFixture();
  assert.equal(matchesPersistedImmutableInput(job, job.immutableInput), true);
  assert.deepEqual(selectTranscoderInputSource(job, true), {
    mode: 'immutable',
    sourceStoragePath: job.immutableInput?.destinationStoragePath,
    sourceGeneration: SOURCE_GENERATION,
    destinationGeneration: DESTINATION_GENERATION,
    sizeBytes: SIZE,
    crc32c: CRC32C,
  });
});

test('source selection: flag ON fails closed without probe, copy, or valid generation', () => {
  const original = jobFixture();
  const jobs = [
    { ...original, sourceProbe: null },
    { ...original, immutableInput: null },
    { ...original, sourceGeneration: 'not-a-generation' },
    { ...original, sourceGeneration: '' },
  ];
  for (const job of jobs) assert.equal(selectTranscoderInputSource(job, true), null);
});

test('source selection: rejects replacement, version drift and source size drift', () => {
  const job = jobFixture();
  for (const change of [
    { processingVersion: 'anotherVersion' },
    { sourceStoragePath: 'users/testOwner/uploads/videos/testVideo-replaced.mp4' },
    { sourceGeneration: '90071992547409940' },
    { sourceSizeBytes: 999 },
  ]) {
    assert.equal(selectTranscoderInputSource({ ...job, ...change }, true), null);
  }
});

test('source selection: rejects forged destination path, generation, size and CRC32C', () => {
  const job = jobFixture();
  for (const change of [
    { destinationStoragePath: 'users/other/processed/video-transcoder-inputs/testVideo/x/source.mp4' },
    { destinationGeneration: 'bad' },
    { sizeBytes: 999 },
    { crc32c: 'invalid-' },
    { sourceStoragePath: 'users/another/uploads/videos/testVideo-original.mp4' },
    { sourceGeneration: '22' },
  ]) {
    const altered = { ...job.immutableInput!, ...change };
    assert.equal(matchesPersistedImmutableInput(job, altered), false);
    assert.equal(selectTranscoderInputSource({ ...job, immutableInput: altered }, true), null);
  }
});

test('source selection: webm opt-in keeps versioned webm copy path', () => {
  const job = jobFixture();
  job.sourceMimeType = 'video/webm';
  job.sourceStoragePath = 'users/testOwner/uploads/videos/testVideo-original.webm';
  job.sourceProbe = { ...job.sourceProbe!, sourceStoragePath: job.sourceStoragePath };
  job.immutableInput = {
    ...job.immutableInput!,
    sourceStoragePath: job.sourceStoragePath,
    destinationStoragePath: buildImmutableTranscoderInputPath(job),
  };
  const selected = selectTranscoderInputSource(job, true);
  assert.equal(selected?.mode, 'immutable');
  assert.ok(selected?.sourceStoragePath.endsWith('/source.webm'));
});

test('source selection: invalid destination cannot be rescued by a valid probe', () => {
  const job = jobFixture();
  job.immutableInput = { ...job.immutableInput!, destinationGeneration: '' };
  assert.equal(selectTranscoderInputSource(job, true), null);
});
