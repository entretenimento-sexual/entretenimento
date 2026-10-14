import assert from 'node:assert/strict';
import test from 'node:test';

import { buildQueuedVideoProcessingJob } from './video-processing-job';
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

function ports(events: string[], overrides: Partial<VideoCancellationPorts> = {})
: VideoCancellationPorts {
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
