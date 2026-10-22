import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const handler = readFileSync(
  join(__dirname, '../../../src/media/application/delete-profile-photo.handler.ts'),
  'utf8'
);

test('private photo deletion persists the original GCS generation with its job', () => {
  assert.match(handler, /capturePrivatePhotoGeneration\(storagePath\)/);
  assert.match(handler, /storageGeneration,/);
  assert.match(handler, /tx\.create\(jobRef, job\)/);
  assert.match(handler, /ifGenerationMatch: expected/);
});

test('legacy private photo jobs fail closed without discovering replacement generations', () => {
  assert.match(handler, /normalizeGcsGeneration\(job\.storageGeneration\)/);
  assert.match(handler, /Unpinned private photo deletion; manual review required/);
  assert.match(handler, /needsReview \? 'dead_letter' : retry\.state/);
  assert.doesNotMatch(handler, /\.delete\(\{ ignoreNotFound: true \}\)/);
});
