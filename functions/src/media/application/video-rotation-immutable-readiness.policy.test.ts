import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  matchesPinnedRotatedSource,
  type PinnedTranscoderInputSource,
  type RotationStorageMetadata,
} from './video-rotation-immutable-readiness.policy';

const job = { processingVersion: '1800000000000-abc' };
const source: PinnedTranscoderInputSource = {
  mode: 'immutable',
  sourceStoragePath: 'users/u/processed/video-transcoder-inputs/v/1800000000000-abc/source.mp4',
  sourceGeneration: '90071992547409930',
  destinationGeneration: '90071992547409999',
  sizeBytes: 100_000,
  crc32c: 'AAAAAA==',
};

function valid(): RotationStorageMetadata {
  return {
    generation: '90071992547409991',
    size: '290000',
    contentType: 'video/mp4',
    metadata: {
      source: 'video-rotation-worker',
      processingVersion: job.processingVersion,
      rotationDegrees: '90',
      immutableInputStoragePath: source.sourceStoragePath,
      immutableInputGeneration: source.destinationGeneration,
      immutableInputCrc32c: source.crc32c,
    },
  };
}

test('rotation provenance accepts exact immutable generation and tags', () => {
  assert.equal(matchesPinnedRotatedSource(job, source, 90, valid()), true);
});

test('rotation provenance does not accept rotated result with another version', () => {
  assert.equal(matchesPinnedRotatedSource({ processingVersion: 'replacement' },
    source, 90, valid()), false);
});

test('rotation provenance does not accept an older input generation', () => {
  const raw = valid();
  assert.equal(matchesPinnedRotatedSource(job, source, 90, {
    ...raw, metadata: { ...raw.metadata, immutableInputGeneration: '90071992547409998' },
  }), false);
});

test('rotation provenance rejects different input path and CRC32C', () => {
  const raw = valid();
  for (const key of ['immutableInputStoragePath', 'immutableInputCrc32c']) {
    assert.equal(matchesPinnedRotatedSource(job, source, 90, {
      ...raw, metadata: { ...raw.metadata, [key]: 'different' },
    }), false);
  }
});

test('rotation provenance rejects rotation angle or provenance source mismatch', () => {
  const raw = valid();
  assert.equal(matchesPinnedRotatedSource(job, source, 180, raw), false);
  assert.equal(matchesPinnedRotatedSource(job, source, 90, {
    ...raw, metadata: { ...raw.metadata, source: 'another-writer' },
  }), false);
});

test('rotation provenance requires valid GCS generation, non-empty MP4 and bounded size', () => {
  const raw = valid();
  for (const change of [
    { generation: '0' }, { generation: Number(source.destinationGeneration) },
    { size: '0' }, { size: String(750 * 1024 * 1024 + 1) },
    { contentType: 'video/webm' }, { metadata: {} },
  ]) {
    assert.equal(matchesPinnedRotatedSource(job, source, 90,
      { ...raw, ...change }), false);
  }
  // Numeric GCS generations above MAX_SAFE_INTEGER must never be accepted.
});

test('rotation provenance refuses null and unsupported angles', () => {
  assert.equal(matchesPinnedRotatedSource(job, source, 90, null), false);
  assert.equal(matchesPinnedRotatedSource(job, source, 0, valid()), false);
});
