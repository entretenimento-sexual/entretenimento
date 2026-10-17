import assert from 'node:assert/strict';
import test from 'node:test';

import { buildQueuedVideoProcessingJob, type VideoProcessingJob } from './video-processing-job';
import {
  executeVideoCancellation,
  type VideoCancellationPorts,
} from './video-cancellation-execution';

const now = 1_800_000_000_000;
const providerName = 'projects/demo/locations/us-central1/jobs/sample';

function job() {
  return {
    ...buildQueuedVideoProcessingJob({
      ownerUid: 'user',
      videoId: 'sample',
      sourceStoragePath: 'users/user/uploads/videos/sample.mp4',
      sourcePosterStoragePath: null,
      sourceMimeType: 'video/mp4',
      sourceSizeBytes: 100,
      sourceDurationMs: 6_000,
      now,
    }),
    state: 'CANCEL_REQUESTED' as const,
    attempts: 1,
    externalJobName: providerName,
  };
}

/** Full, typed immutable copy; no unsafe cast of a partial GCS snapshot. */
function immutableJob(): VideoProcessingJob {
  const current = job();
  const sourceGeneration = '90071992547409930';
  return {
    ...current,
    sourceGeneration,
    immutableInput: {
      sourceStoragePath: current.sourceStoragePath,
      sourceGeneration,
      destinationStoragePath:
        `users/${current.ownerUid}/processed/video-transcoder-inputs/` +
        `${current.videoId}/${current.processingVersion}/source.mp4`,
      destinationGeneration: '90071992547409931',
      sizeBytes: current.sourceSizeBytes,
      crc32c: 'AAAAAA==',
      reused: false,
    },
  };
}

function ports(
  events: string[],
  overrides: Partial<VideoCancellationPorts> = {}
): VideoCancellationPorts {
  return {
    findProviderJob: async () => { events.push('lookup'); return null; },
    bindProviderJob: async () => { events.push('bind'); return true; },
    deleteProviderJob: async () => { events.push('provider-delete'); },
    deleteOutputPrefix: async () => { events.push('storage-delete'); },
    deleteCancelledJob: async () => { events.push('firestore-delete'); return true; },
    recordFailure: async (_job, error) => {
      events.push('failure:' + error.code);
      return true;
    },
    normalizeError: (error) => ({
      code: 'TRANSIENT',
      message: error instanceof Error ? error.message : String(error),
    }),
    now: () => now,
    ...overrides,
  };
}

test('successful cancellation deletes provider, output, then Firestore', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation(job(), ports(events));
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(events, ['provider-delete', 'storage-delete', 'firestore-delete']);
});

test('provider error schedules retry without deleting storage or tracking', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation(job(), ports(events, {
    deleteProviderJob: async () => {
      events.push('provider-delete');
      throw new Error('HTTP 503');
    },
  }));
  assert.equal(result.status, 'RETRY_SCHEDULED');
  assert.deepEqual(events, ['provider-delete', 'failure:TRANSIENT']);
});

test('invalid provider ID stops cleanup when adapter rejects it', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation({
    ...job(), externalJobName: 'invalid',
  }, ports(events, {
    deleteProviderJob: async () => {
      throw new Error('Identificador do job de transcodificação inválido.');
    },
  }));
  assert.equal(result.status, 'RETRY_SCHEDULED');
  assert.deepEqual(events, ['failure:TRANSIENT']);
});

test('unknown submission holds the record and never deletes output', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation({
    ...job(), externalJobName: null,
  }, ports(events));
  assert.equal(result.status, 'UNCONFIRMED');
  assert.deepEqual(events, ['lookup', 'failure:CANCELLATION_UNCONFIRMED']);
});

test('a newer attempt wins before binding an unconfirmed provider ID', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation({
    ...job(), externalJobName: null,
  }, ports(events, {
    findProviderJob: async () => ({ name: providerName }),
    bindProviderJob: async () => { events.push('bind'); return false; },
  }));
  assert.equal(result.status, 'REPLACED');
  assert.deepEqual(events, ['bind']);
});

test('never delete a provider resource when submission was never attempted', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation({
    ...job(), attempts: 0, externalJobName: null,
  }, ports(events));
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(events, ['storage-delete', 'firestore-delete']);
});

test('storage failure preserves tracking and schedules a retry', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation(job(), ports(events, {
    deleteOutputPrefix: async () => {
      events.push('storage-delete');
      throw new Error('Storage temporarily unavailable');
    },
  }));
  assert.equal(result.status, 'RETRY_SCHEDULED');
  assert.deepEqual(events, [
    'provider-delete', 'storage-delete', 'failure:TRANSIENT',
  ]);
});

test('non-cancellation state does not call any external dependency', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation({
    ...job(), state: 'PROCESSING',
  }, ports(events));
  assert.equal(result.status, 'REPLACED');
  assert.deepEqual(events, []);
});

test('immutable cancellation deletes pinned input before removing tracking', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation(immutableJob(), ports(events, {
    deleteImmutableInput: async () => {
      events.push('immutable-delete');
      return true;
    },
  }));
  assert.equal(result.status, 'COMPLETED');
  assert.deepEqual(events, [
    'provider-delete', 'storage-delete', 'immutable-delete', 'firestore-delete',
  ]);
});

test('ambiguous provider never deletes immutable copy', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation({
    ...immutableJob(), externalJobName: null,
  }, ports(events, {
    deleteImmutableInput: async () => { events.push('immutable-delete'); return true; },
  }));
  assert.equal(result.status, 'UNCONFIRMED');
  assert.deepEqual(events, ['lookup', 'failure:CANCELLATION_UNCONFIRMED']);
});

test('stale immutable claim keeps Firestore tracking and does not report success', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation(immutableJob(), ports(events, {
    deleteImmutableInput: async () => { events.push('immutable-check'); return false; },
  }));
  assert.equal(result.status, 'REPLACED');
  assert.deepEqual(events, [
    'provider-delete', 'storage-delete', 'immutable-check',
  ]);
});

test('immutable deletion failure keeps the cancellation for durable retry', async () => {
  const events: string[] = [];
  const result = await executeVideoCancellation(immutableJob(), ports(events, {
    deleteImmutableInput: async () => { throw new Error('GCS 412'); },
  }));
  assert.equal(result.status, 'RETRY_SCHEDULED');
  assert.deepEqual(events, [
    'provider-delete', 'storage-delete', 'failure:TRANSIENT',
  ]);
});
