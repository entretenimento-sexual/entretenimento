#!/usr/bin/env node
/**
 * Explicit, non-deploying production-GCS precondition verification.
 * Run only with ADC credentials scoped to a dedicated disposable test bucket.
 * Never run through the Firebase Storage Emulator or on live user objects.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';

const ack = 'WRITE_ISOLATED_TEST_OBJECTS';
const bucketName = String(process.env.MEDIA_GCS_LIVE_TEST_BUCKET ?? '').trim();
if (process.env.MEDIA_GCS_LIVE_ACK !== ack) {
  throw new Error('Explicit MEDIA_GCS_LIVE_ACK is required for isolated-bucket writes.');
}
if (!bucketName || !/test|sandbox|staging|nonprod/i.test(bucketName) ||
    bucketName.includes('/') || bucketName.includes(' ')) {
  throw new Error('MEDIA_GCS_LIVE_TEST_BUCKET must name a dedicated non-production test bucket.');
}
if (process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST ||
    process.env.FIREBASE_EMULATOR_HUB || process.env.FUNCTIONS_EMULATOR) {
  throw new Error('Live GCS verification refuses Firebase emulator configuration.');
}

const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getStorage } = require('firebase-admin/storage');

function generation(value) {
  const text = String(value ?? '');
  if (!/^[1-9]\d{0,19}$/.test(text) ||
      BigInt(text) > 18446744073709551615n) {
    throw new Error('Cloud Storage returned an invalid generation.');
  }
  return text;
}

function expect412(error) {
  return Number(error?.code ?? error?.statusCode ?? error?.status) === 412;
}

const app = initializeApp({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
const objectPath = `__media_precondition_certification/${randomUUID()}`;
const file = getStorage(app).bucket(bucketName).file(objectPath);
let ownedGeneration = null;
let verified = false;

try {
  await file.save(Buffer.from('initial-object'), {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: 0 },
    metadata: { contentType: 'text/plain' },
  });
  ownedGeneration = generation((await file.getMetadata())[0].generation);

  // Another create-only write must NOT overwrite an existing live generation.
  await assert.rejects(
    file.save(Buffer.from('forbidden-overwrite'), {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
    }),
    expect412
  );
  assert.equal((await file.download())[0].toString(), 'initial-object');

  // Replace only the generation that this verification created.
  await file.save(Buffer.from('replacement-object'), {
    resumable: false,
    preconditionOpts: { ifGenerationMatch: ownedGeneration },
  });
  const replacementGeneration = generation((await file.getMetadata())[0].generation);
  assert.notEqual(replacementGeneration, ownedGeneration);
  const staleGeneration = ownedGeneration;
  ownedGeneration = replacementGeneration;

  // A delayed old-generation cleanup must not delete the replacement.
  await assert.rejects(
    file.delete({ ifGenerationMatch: staleGeneration }),
    expect412
  );
  assert.equal((await file.download())[0].toString(), 'replacement-object');
  verified = true;
} finally {
  try {
    // Never delete anything unless its live generation matches this test's
    // last proven write. Leave an ambiguous object for manual inspection.
    if (ownedGeneration) {
      const [metadata] = await file.getMetadata();
      if (generation(metadata.generation) !== ownedGeneration) {
        throw new Error(`Unrecognized generation at gs://${bucketName}/${objectPath}; manual cleanup required.`);
      }
      await file.delete({ ifGenerationMatch: ownedGeneration });
      ownedGeneration = null;
    }
  } finally {
    await deleteApp(app);
  }
}
assert.equal(verified, true);
console.log(JSON.stringify({
  check: 'media-live-gcs-generation-preconditions',
  status: 'passed',
  bucket: bucketName,
  createOnlyRejectedOverwrite: true,
  staleGenerationRejectedDeletion: true,
  fixtureDeleted: true,
}));
