import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const service = readFileSync(
  join(__dirname, '../../../src/media/application/published-video-asset.service.ts'),
  'utf8'
);
const queue = readFileSync(
  join(__dirname, '../../../src/media/application/published-video-cleanup-queue.firestore.ts'),
  'utf8'
);

test('published videos and posters delete only the captured GCS generation', () => {
  assert.match(service, /capturePublishedAssetGeneration\(/);
  assert.match(service, /deleteGenerationPinnedVideoFile\(generation,/);
  assert.match(service, /ifGenerationMatch: expected/);
  assert.match(service, /preconditionOpts: \{ ifGenerationMatch: 0 \}/);
  assert.doesNotMatch(service, /\.delete\(\{ ignoreNotFound: true \}\)/);
});

test('a legacy published video retry cannot delete an unidentified generation', () => {
  assert.match(service, /!normalizeGcsGeneration\(job\.generation\)/);
  assert.match(service, /Missing GCS generation; manual review required/);
  assert.match(queue, /manualReview \? 'dead_letter' : retry\.state/);
  assert.match(queue, /manualReview \? null : retry\.nextAttemptAt/);
});

test('a GCS generation conflict cannot be retried without a precondition', () => {
  assert.match(service, /error instanceof VideoDeletionGenerationConflictError/);
  assert.match(service, /previousGeneration && generation && previousGeneration !== generation/);
  assert.match(queue, /leaseToken'\] !== token/);
});

test('uncertain poster copy persists a manual-review cleanup obligation', () => {
  assert.match(service, /reason: 'unconfirmed-published-poster-copy'/);
  assert.match(service, /enqueuePublishedVideoAssetCleanup\(\{/);
  assert.doesNotMatch(service, /destinationPoster\s*\.delete\(/);
});
