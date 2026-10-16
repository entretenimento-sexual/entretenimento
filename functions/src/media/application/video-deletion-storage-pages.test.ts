import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  deleteGenerationPinnedVideoFile,
  deleteVideoStoragePrefixBounded,
  VideoDeletionGenerationConflictError,
  VIDEO_DELETION_STORAGE_CONCURRENCY,
  VIDEO_DELETION_STORAGE_MAX_FILES_PER_ATTEMPT,
  VIDEO_DELETION_STORAGE_PAGE_SIZE,
} from './video-deletion-storage-pages';

const prefix = 'users/owner/processed/videos/video/version-123/';

test('rejects broad video prefixes before listing or deleting', async () => {
  let calls = 0;
  for (const invalid of [
    '',
    'users/owner/processed/videos/video/',
    'users/owner/uploads/videos/video-',
    'users/owner/processed/videos/video/version-123/subfolder/',
  ]) {
    await assert.rejects(
      deleteVideoStoragePrefixBounded(invalid, async () => {
        calls += 1;
        return [];
      }),
      /Unsafe video deletion storage prefix/
    );
  }
  assert.equal(calls, 0);
});

test('deletes version-specific objects through bounded pages and concurrency', async () => {
  const remaining = Array.from({ length: 43 }, (_, index) => index);
  const limits: number[] = [];
  let inFlight = 0;
  let maximumInFlight = 0;
  const deleted = await deleteVideoStoragePrefixBounded(prefix, async (actualPrefix, limit) => {
    assert.equal(actualPrefix, prefix);
    limits.push(limit);
    return remaining.slice(0, limit).map((item) => ({
      delete: async () => {
        inFlight += 1;
        maximumInFlight = Math.max(inFlight, maximumInFlight);
        await Promise.resolve();
        remaining.splice(remaining.indexOf(item), 1);
        inFlight -= 1;
      },
    }));
  });
  assert.equal(deleted, 43);
  assert.deepEqual(remaining, []);
  assert.ok(limits.every((limit) => limit <= VIDEO_DELETION_STORAGE_PAGE_SIZE));
  assert.ok(maximumInFlight <= VIDEO_DELETION_STORAGE_CONCURRENCY);
});

test('stops at work cap and requires durable retry for remaining files', async () => {
  const remaining = Array.from({ length: VIDEO_DELETION_STORAGE_MAX_FILES_PER_ATTEMPT + 3 },
    (_, index) => index);
  await assert.rejects(deleteVideoStoragePrefixBounded(prefix, async (_, limit) =>
    remaining.slice(0, limit).map((item) => ({
      delete: async () => {
        remaining.splice(remaining.indexOf(item), 1);
      },
    }))
  ), /continuation required/);
  assert.equal(remaining.length, 3);
});

test('surfaces partial delete failures for job retry', async () => {
  let deleted = 0;
  await assert.rejects(deleteVideoStoragePrefixBounded(prefix, async () => [
    { delete: async () => { deleted += 1; } },
    { delete: async () => { throw new Error('GCS unavailable'); } },
  ]), /GCS unavailable/);
  assert.ok(deleted >= 1);
});

test('generation-pinned delete forwards the exact GCS generation without rounding', async () => {
  const generation = '18446744073709551615';
  const observed: string[] = [];
  await deleteGenerationPinnedVideoFile(generation, async (g) => {
    observed.push(g);
  });
  assert.deepEqual(observed, [generation]);
});

test('generation-pinned delete fails closed before contacting GCS on missing metadata', async () => {
  let called = 0;
  for (const invalid of [null, undefined, '', '0', '001', -1, 1.5,
    Number.MAX_SAFE_INTEGER + 1, '18446744073709551616', 'not-a-number']) {
    await assert.rejects(
      deleteGenerationPinnedVideoFile(invalid, async () => { called += 1; }),
      VideoDeletionGenerationConflictError
    );
  }
  assert.equal(called, 0);
});

test('GCS generation mismatch 412 blocks rather than retrying without a precondition', async () => {
  let calls = 0;
  await assert.rejects(
    deleteGenerationPinnedVideoFile('123456', async () => {
      calls += 1;
      throw Object.assign(new Error('Precondition Failed'), { code: 412 });
    }),
    VideoDeletionGenerationConflictError
  );
  assert.equal(calls, 1);
});

test('transient GCS errors retain their identity for normal durable retry', async () => {
  const transient = Object.assign(new Error('Storage unavailable'), { code: 503 });
  await assert.rejects(
    deleteGenerationPinnedVideoFile('123456', async () => { throw transient; }),
    (error: unknown) => error === transient
  );
});
