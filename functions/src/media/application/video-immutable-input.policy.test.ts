import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { VideoProcessingJob } from './video-processing-job';
import {
  buildImmutableTranscoderInputPath,
  prepareImmutableTranscoderInputWithPort,
  type GcsObjectSnapshot,
  type ImmutableInputCopyCommand,
  type ImmutableInputStoragePort,
} from './video-immutable-input.policy';

const sourceGeneration = '90071992547409933';
const size = 100_000;
const crc32c = 'AAAAAA==';

function jobFixture(): VideoProcessingJob {
  const job = {
    ownerUid: 'testOwner', videoId: 'testVideo',
    processingVersion: '1800000000000-0123-4567',
    sourceStoragePath: 'users/testOwner/uploads/videos/testVideo-original.mp4',
    sourceGeneration, sourceMimeType: 'video/mp4', sourceSizeBytes: size,
  } as VideoProcessingJob;
  job.sourceProbe = {
    processingVersion: job.processingVersion,
    sourceStoragePath: job.sourceStoragePath,
    sourceGeneration,
    sourceSizeBytes: size,
    widthPixels: 1920,
    heightPixels: 1080,
    durationMs: 15_000,
    displayAspectNumerator: 1920,
    displayAspectDenominator: 1080,
    embeddedRotationDegrees: 0,
    sampleAspectRatio: { numerator: 1, denominator: 1 },
    videoCodec: 'h264', hasAudio: false, audioCodec: null,
    checkedAt: 1800000000000,
  };
  return job;
}

function mockStorage(job: VideoProcessingJob) {
  const source: GcsObjectSnapshot = {
    generation: sourceGeneration, size: String(size), crc32c,
    contentType: 'video/mp4',
  };
  let destination: GcsObjectSnapshot | null = null;
  const calls: ImmutableInputCopyCommand[] = [];
  let copyError: { code: number } | null = null;
  const port: ImmutableInputStoragePort = {
    async readPinnedSource(path, generation) {
      assert.equal(path, job.sourceStoragePath);
      assert.equal(generation, sourceGeneration);
      return source;
    },
    async readDestination(path) {
      assert.equal(path, buildImmutableTranscoderInputPath(job));
      return destination;
    },
    async copyPinnedSource(command) {
      calls.push(command);
      if (copyError) throw copyError;
      if (destination) throw { code: 412 };
      destination = {
        generation: '99999999999999912', size: String(size), crc32c,
        contentType: 'video/mp4', metadata: command.metadata,
      };
    },
  };
  return {
    source, calls, port,
    setDestination(v: GcsObjectSnapshot | null) { destination = v; },
    setCopyError(code: number) { copyError = { code }; },
    getDestination() { return destination; },
  };
}

function rejectsCode(promise: Promise<unknown>, code: string) {
  return assert.rejects(promise, error =>
    !!error && typeof error === 'object' &&
    'code' in error && error.code === code);
}

test('immutable input: pins big-int generation as string and creates destination once', async () => {
  const job = jobFixture();
  const mock = mockStorage(job);
  const result = await prepareImmutableTranscoderInputWithPort(job, mock.port);
  assert.equal(result.sourceGeneration, sourceGeneration);
  assert.equal(result.destinationGeneration, '99999999999999912');
  assert.equal(result.reused, false);
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].sourceGeneration, sourceGeneration);
  assert.equal(mock.calls[0].ifDestinationGenerationMatch, 0);
  assert.equal(mock.calls[0].metadata.sourceCrc32c, crc32c);
  assert.match(result.destinationStoragePath, /video-transcoder-inputs/);
  assert.ok(!result.destinationStoragePath.startsWith(
    `users/${job.ownerUid}/processed/videos/${job.videoId}/`));
});

test('immutable input: reuse requires exact identity and CRC, with no second copy', async () => {
  const job = jobFixture();
  const mock = mockStorage(job);
  await prepareImmutableTranscoderInputWithPort(job, mock.port);
  const second = await prepareImmutableTranscoderInputWithPort(job, mock.port);
  assert.equal(second.reused, true);
  assert.equal(mock.calls.length, 1);
});

test('immutable input: refuses stale ffprobe version before Storage I/O', async () => {
  const job = jobFixture();
  job.sourceProbe = { ...job.sourceProbe!, processingVersion: 'stale' };
  let contacted = false;
  const mock = mockStorage(job);
  mock.port.readPinnedSource = async () => { contacted = true; return mock.source; };
  await rejectsCode(prepareImmutableTranscoderInputWithPort(job, mock.port),
    'IMMUTABLE_INPUT_PROBE_NOT_CURRENT');
  assert.equal(contacted, false);
});

test('immutable input: refuses changed GCS generation, bytes, or checksum', async () => {
  for (const change of [{ generation: '1' }, { size: '999' }, { crc32c: '' }]) {
    const job = jobFixture();
    const mock = mockStorage(job);
    mock.port.readPinnedSource = async () => ({ ...mock.source, ...change });
    await rejectsCode(prepareImmutableTranscoderInputWithPort(job, mock.port),
      'IMMUTABLE_INPUT_SOURCE_CHANGED');
    assert.equal(mock.calls.length, 0);
  }
});

test('immutable input: conflicting destination must never be overwritten', async () => {
  const job = jobFixture();
  const mock = mockStorage(job);
  mock.setDestination({ generation: '77', size: String(size), crc32c,
    contentType: 'video/mp4', metadata: { sourceGeneration: 'BAD' } });
  await rejectsCode(prepareImmutableTranscoderInputWithPort(job, mock.port),
    'IMMUTABLE_INPUT_DESTINATION_CONFLICT');
  assert.equal(mock.calls.length, 0);
});

test('immutable input: ambiguous copy success is recovered by verifying destination', async () => {
  const job = jobFixture();
  const mock = mockStorage(job);
  mock.port.copyPinnedSource = async command => {
    mock.setDestination({ generation: '90071992547409945', size: String(size), crc32c,
      contentType: 'video/mp4', metadata: command.metadata });
    throw { code: 503 };
  };
  const result = await prepareImmutableTranscoderInputWithPort(job, mock.port);
  assert.equal(result.destinationGeneration, '90071992547409945');
  assert.equal(result.reused, true);
});

test('immutable input: transient copy failure without destination is retryable', async () => {
  const job = jobFixture();
  const mock = mockStorage(job);
  mock.setCopyError(503);
  await rejectsCode(prepareImmutableTranscoderInputWithPort(job, mock.port),
    'IMMUTABLE_INPUT_TEMPORARY_UNAVAILABLE');
});

test('immutable input: source missing cannot create a copy or authorize Transcoder', async () => {
  const job = jobFixture();
  const mock = mockStorage(job);
  mock.port.readPinnedSource = async () => null;
  await rejectsCode(prepareImmutableTranscoderInputWithPort(job, mock.port),
    'IMMUTABLE_INPUT_SOURCE_CHANGED');
  assert.equal(mock.calls.length, 0);
});

test('immutable input: destination path and type are strict and version-scoped', () => {
  const job = jobFixture();
  const first = buildImmutableTranscoderInputPath(job);
  const version = buildImmutableTranscoderInputPath({ ...job, processingVersion: 'another-version' });
  assert.notEqual(first, version);
  assert.ok(first.endsWith('/source.mp4'));
  const webm = buildImmutableTranscoderInputPath({ ...job, sourceMimeType: 'video/webm' });
  assert.ok(webm.endsWith('/source.webm'));
  assert.throws(() => buildImmutableTranscoderInputPath({ ...job,
    sourceStoragePath: 'users/another/uploads/videos/testVideo-original.mp4' }));
});
