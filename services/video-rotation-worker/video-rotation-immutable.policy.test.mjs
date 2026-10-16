import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import {
  ImmutableRotationInputError,
  requireImmutableRotationInput,
  matchesImmutableRotationSource,
  matchesImmutableRotationDestination,
  immutableRotationOutputMetadata,
} from './video-rotation-immutable.policy.mjs';

const generation = '90071992547409935';
const originalGeneration = '90071992547409933';
const crc32c = 'AAAAAA==';
const originalPath = 'users/testOwner/uploads/videos/testVideo-upload.mp4';
const processingVersion = '1800000000000-0123-4567';
const immutablePath = `users/testOwner/processed/video-transcoder-inputs/` +
  `testVideo/${processingVersion}/source.mp4`;

function command() {
  return {
    ownerUid: 'testOwner', videoId: 'testVideo', processingVersion,
    immutableInput: {
      sourceStoragePath: originalPath,
      sourceGeneration: originalGeneration,
      destinationStoragePath: immutablePath,
      destinationGeneration: generation,
      sizeBytes: 123456,
      crc32c,
    },
  };
}
function source(input) {
  return {
    generation: input.destinationGeneration,
    size: String(input.sizeBytes), crc32c, contentType: 'video/mp4',
    metadata: {
      source: 'video-immutable-transcoder-input',
      processingVersion,
      sourceStoragePath: originalPath,
      sourceGeneration: originalGeneration,
      sourceCrc32c: crc32c,
    },
  };
}
function output(input, degree = 90) {
  return {
    generation: '90071992547409939', size: '230000',
    contentType: 'video/mp4',
    metadata: immutableRotationOutputMetadata(input, degree),
  };
}
function rejects(p, path = originalPath) {
  assert.throws(() => requireImmutableRotationInput(p, path),
    ImmutableRotationInputError);
}

test('immutable rotation accepts exact, large-integer generation and copied provenance', () => {
  const input = requireImmutableRotationInput(command(), originalPath);
  assert.equal(input.destinationGeneration, generation);
  assert.equal(input.sourceGeneration, originalGeneration);
  assert.equal(input.sourceContentType, 'video/mp4');
  assert.equal(matchesImmutableRotationSource(input, source(input)), true);
  assert.equal(matchesImmutableRotationDestination(input, 90, output(input)), true);
});

test('immutable rotation rejects missing or malformed opt-in input', () => {
  rejects({ ...command(), immutableInput: null });
  rejects({ ...command(), immutableInput: {} });
  rejects({ ...command(), immutableInput: { ...command().immutableInput,
    destinationGeneration: '90071992547409935.0' } });
  rejects({ ...command(), immutableInput: { ...command().immutableInput,
    sizeBytes: Number.MAX_SAFE_INTEGER } });
  rejects({ ...command(), immutableInput: { ...command().immutableInput,
    crc32c: 'invalid+!/crc' } });
});

test('immutable rotation never accepts original/foreign/different-version destination', () => {
  const p = command();
  for (const path of [originalPath, immutablePath.replace('testOwner', 'other'),
    immutablePath.replace(processingVersion, 'stale'),
    immutablePath.replace('source.mp4', 'source.mov'),
    immutablePath.replace('testVideo', 'anotherVideo')]) {
    rejects({ ...p, immutableInput: { ...p.immutableInput,
      destinationStoragePath: path } });
  }
  rejects(p, originalPath.replace('testOwner', 'foreign'));
});

test('immutable rotation rejects changed source generation and mismatched metadata', () => {
  const input = requireImmutableRotationInput(command(), originalPath);
  const good = source(input);
  for (const change of [
    { generation: '1' }, { crc32c: 'BBBBBB==' },
    { size: '123455' }, { contentType: 'video/webm' },
    { metadata: { ...good.metadata, sourceGeneration: '1' } },
    { metadata: { ...good.metadata, sourceStoragePath: 'foreign' } },
    { metadata: { ...good.metadata, processingVersion: 'stale' } },
  ]) assert.equal(matchesImmutableRotationSource(input, { ...good, ...change }), false);
});

test('immutable rotation refuses to reuse rotated bytes from another input or recipe', () => {
  const input = requireImmutableRotationInput(command(), originalPath);
  const good = output(input);
  assert.equal(matchesImmutableRotationDestination(input, 90, good), true);
  assert.equal(matchesImmutableRotationDestination(input, 180, good), false);
  const badGeneration = { ...good, metadata: {
    ...good.metadata, immutableInputGeneration: '1',
  } };
  assert.equal(matchesImmutableRotationDestination(input, 90, badGeneration), false);
  assert.equal(matchesImmutableRotationDestination(input, 90,
    { ...good, contentType: 'application/octet-stream' }), false);
  assert.equal(matchesImmutableRotationDestination(input, 90,
    { ...good, size: String(751 * 1024 * 1024) }), false);
});

test('immutable rotation supports webm inputs and mp4 rotation outputs', () => {
  const p = command();
  p.immutableInput.destinationStoragePath = immutablePath.replace('.mp4', '.webm');
  const input = requireImmutableRotationInput(p, originalPath);
  assert.equal(input.sourceContentType, 'video/webm');
  const metadata = source(input);
  metadata.contentType = 'video/webm';
  assert.equal(matchesImmutableRotationSource(input, metadata), true);
  assert.equal(matchesImmutableRotationDestination(input, 270, output(input, 270)), true);
});

test('rotation server contract routes explicit opt-in through GCS generation fencing', () => {
  const source = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8');
  assert.match(source, /requireImmutableRotationInput\(payload, sourceStoragePath\)/);
  assert.match(source, /generation: immutableInput\.destinationGeneration/);
  assert.match(source, /matchesImmutableRotationSource\(immutableInput, sourceMetadata\)/);
  assert.match(source, /ifGenerationMatch: 0/);
  assert.match(source, /matchesImmutableRotationDestination\(immutableInput, rotationDegrees, metadata\)/);
  assert.match(source, /validation: 'crc32c'/);
});
