import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildQueuedVideoProcessingJob, type VideoProcessingJob } from './video-processing-job';
import type { VideoRotationDegrees } from './video-edit-recipe';
import type { ImmutableCancellationObject } from './video-immutable-cancellation-cleanup.policy';
import {
  cleanupTerminalVideoTemporaryAssets,
  cleanupCancelledRotationTemporaryAsset,
  hasTerminalTemporaryAssets,
  isConfirmedTerminalVideoJob,
  type TerminalTemporaryCleanupPorts,
} from './video-terminal-temporary-cleanup.policy';

function job(rotation: VideoRotationDegrees = 90): VideoProcessingJob {
  const queued = buildQueuedVideoProcessingJob({
    ownerUid: 'user', videoId: 'video',
    sourceStoragePath: 'users/user/uploads/videos/video-original.mp4',
    sourcePosterStoragePath: null, sourceMimeType: 'video/mp4',
    sourceSizeBytes: 100_000, sourceDurationMs: 12_000, now: 1_800_000_000_000,
  });
  const sourceGeneration = '90071992547409931';
  return {
    ...queued, state: 'SUCCEEDED', providerState: 'SUCCEEDED',
    externalJobName: 'projects/demo/locations/us-central1/jobs/video',
    attempts: 1, sourceGeneration,
    sourceProbe: {
      processingVersion: queued.processingVersion,
      sourceStoragePath: queued.sourceStoragePath,
      sourceGeneration, sourceSizeBytes: queued.sourceSizeBytes,
      widthPixels: 1280, heightPixels: 720, durationMs: 12_000,
      embeddedRotationDegrees: 0,
      displayAspectNumerator: 16, displayAspectDenominator: 9,
      sampleAspectRatio: { numerator: 1, denominator: 1 },
      videoCodec: 'h264', hasAudio: false, audioCodec: null,
      checkedAt: 1_800_000_000_000,
    },
    immutableInput: {
      sourceStoragePath: queued.sourceStoragePath, sourceGeneration,
      destinationStoragePath: 'users/user/processed/video-transcoder-inputs/video/' +
        queued.processingVersion + '/source.mp4',
      destinationGeneration: '90071992547409932',
      sizeBytes: queued.sourceSizeBytes, crc32c: 'AAAAAA==', reused: false,
    },
    editRecipe: { ...queued.editRecipe!, rotationDegrees: rotation },
  };
}

function objects(j: VideoProcessingJob): Map<string, ImmutableCancellationObject> {
  const input = j.immutableInput!;
  return new Map<string, ImmutableCancellationObject>([
    [input.destinationStoragePath, {
      generation: input.destinationGeneration,
      size: String(input.sizeBytes), crc32c: input.crc32c,
      contentType: j.sourceMimeType,
      metadata: {
        source: 'video-immutable-transcoder-input',
        processingVersion: j.processingVersion,
        sourceStoragePath: j.sourceStoragePath,
        sourceGeneration: j.sourceGeneration,
        sourceCrc32c: input.crc32c,
      },
    }],
    ['users/user/processed/video-rotation-sources/video/' +
      j.processingVersion + '/source.mp4', {
      generation: '90071992547409933', size: '200000',
      contentType: 'video/mp4',
      metadata: {
        source: 'video-rotation-worker',
        processingVersion: j.processingVersion,
        rotationDegrees: '90',
        immutableInputStoragePath: input.destinationStoragePath,
        immutableInputGeneration: input.destinationGeneration,
        immutableInputCrc32c: input.crc32c,
      },
    }],
  ]);
}
function ports(j: VideoProcessingJob) {
  const stored = objects(j);
  const deleted: Array<[string, string]> = [];
  let current = true;
  const p: TerminalTemporaryCleanupPorts = {
    claimIsCurrent: async () => current,
    readObject: async path => stored.get(path) ?? null,
    deletePinned: async (path, generation) => {
      deleted.push([path, generation]);
      stored.delete(path);
    },
  };
  return { stored, deleted, p, setCurrent(v: boolean) { current = v; } };
}

test('terminal verified inputs are cleaned rotation first with exact generations', async () => {
  const j = job();
  const { p, deleted } = ports(j);
  assert.equal(hasTerminalTemporaryAssets(j), true);
  assert.equal(await cleanupTerminalVideoTemporaryAssets(j, p), true);
  assert.deepEqual(deleted.map(([path]) => path.includes('rotation-sources')),
    [true, false]);
  assert.deepEqual(deleted.map(([, generation]) => generation),
    ['90071992547409933', '90071992547409932']);
  assert.ok(deleted.every(([path]) => !path.includes('/processed/videos/')));
  assert.equal(await cleanupTerminalVideoTemporaryAssets(j, p), true);
  assert.equal(deleted.length, 2);
});

test('failed provider is eligible only after confirmed terminal state', async () => {
  const j = job(0);
  assert.equal(isConfirmedTerminalVideoJob({ ...j, state: 'FAILED',
    providerState: 'FAILED' }), true);
  assert.equal(isConfirmedTerminalVideoJob({ ...j, state: 'FAILED',
    providerState: 'RUNNING' }), false);
  assert.equal(isConfirmedTerminalVideoJob({ ...j, state: 'CANCEL_REQUESTED' }), false);
  assert.equal(isConfirmedTerminalVideoJob({ ...j, state: 'FAILED',
    externalJobName: null, providerState: null, attempts: 0 }), true);
  const { p, deleted } = ports(j);
  await assert.rejects(cleanupTerminalVideoTemporaryAssets({
    ...j, state: 'FAILED', providerState: 'RUNNING',
  }, p), /PROVIDER_UNCONFIRMED/);
  assert.deepEqual(deleted, []);
});

test('invalid immutable snapshot fails before any GCS access', async () => {
  const j = job(0);
  let contacted = false;
  await assert.rejects(cleanupTerminalVideoTemporaryAssets({
    ...j, immutableInput: { ...j.immutableInput!, crc32c: 'invalid' },
  }, {
    claimIsCurrent: async () => { contacted = true; return true; },
    readObject: async () => { contacted = true; return null; },
    deletePinned: async () => { contacted = true; },
  }), /IMMUTABLE_CLEANUP_INVALID_SNAPSHOT/);
  assert.equal(contacted, false);
});

test('stale claim does not read or delete any GCS objects', async () => {
  const j = job();
  const { p, deleted, setCurrent } = ports(j);
  setCurrent(false);
  let reads = 0;
  const result = await cleanupTerminalVideoTemporaryAssets(j, {
    ...p, readObject: async path => { reads++; return p.readObject(path); },
  });
  assert.equal(result, false);
  assert.equal(reads, 0);
  assert.deepEqual(deleted, []);
});

test('claim replacement after rotation read prevents deletion', async () => {
  const j = job();
  const { p, deleted } = ports(j);
  let checks = 0;
  assert.equal(await cleanupTerminalVideoTemporaryAssets(j, {
    ...p, claimIsCurrent: async () => ++checks === 1,
  }), false);
  assert.deepEqual(deleted, []);
});

test('foreign rotation metadata is retained without deleting immutable input', async () => {
  const j = job();
  const { stored, deleted, p } = ports(j);
  const rotationPath = [...stored.keys()].find(path => path.includes('rotation-sources'))!;
  stored.set(rotationPath, { ...stored.get(rotationPath)!, metadata: { source: 'foreign' } });
  await assert.rejects(cleanupTerminalVideoTemporaryAssets(j, p),
    /ROTATION_PROVENANCE_CONFLICT/);
  assert.deepEqual(deleted, []);
});

test('incorrect immutable generation and metadata are fail closed', async () => {
  const j = job(0);
  const { stored, deleted, p } = ports(j);
  stored.set(j.immutableInput!.destinationStoragePath, {
    ...stored.get(j.immutableInput!.destinationStoragePath)!,
    generation: '90071992547409934',
  });
  await assert.rejects(cleanupTerminalVideoTemporaryAssets(j, p),
    /IMMUTABLE_PROVENANCE_CONFLICT/);
  assert.deepEqual(deleted, []);
});

test('GCS failure leaves cleanup incomplete for durable retry', async () => {
  const j = job();
  const { p, deleted } = ports(j);
  await assert.rejects(cleanupTerminalVideoTemporaryAssets(j, {
    ...p, deletePinned: async () => { throw new Error('GCS 503'); },
  }), /GCS 503/);
  assert.deepEqual(deleted, []);
});

test('legacy cancellation requires version provenance and exact GCS generation', async () => {
  const current = job();
  const legacy = { ...current, immutableInput: null };
  const { deleted, p } = ports(current);
  assert.equal(await cleanupCancelledRotationTemporaryAsset(legacy, p), true);
  assert.equal(deleted.length, 1);
  assert.ok(deleted[0][0].includes('/video-rotation-sources/'));
  assert.equal(deleted[0][1], '90071992547409933');
});

test('legacy cancellation rejects a foreign rotation and never calls delete', async () => {
  const current = job();
  const legacy = { ...current, immutableInput: null };
  const { stored, deleted, p } = ports(current);
  const rotationPath = [...stored.keys()].find(x => x.includes('/video-rotation-sources/'))!;
  const original = stored.get(rotationPath)!;
  for (const altered of [
    { ...original, metadata: { ...original.metadata, processingVersion: 'other' } },
    { ...original, generation: '0' },
    { ...original, metadata: { source: 'foreign' } },
  ]) {
    stored.set(rotationPath, altered);
    await assert.rejects(cleanupCancelledRotationTemporaryAsset(legacy, p),
      /ROTATION_PROVENANCE_CONFLICT/);
    assert.deepEqual(deleted, []);
  }
});

test('cancellation never reads GCS after a stale claim', async () => {
  const j = { ...job(), immutableInput: null };
  let read = false;
  const result = await cleanupCancelledRotationTemporaryAsset(j, {
    claimIsCurrent: async () => false,
    readObject: async () => { read = true; return null; },
    deletePinned: async () => { throw new Error('unexpected deletion'); },
  });
  assert.equal(result, false);
  assert.equal(read, false);
});
