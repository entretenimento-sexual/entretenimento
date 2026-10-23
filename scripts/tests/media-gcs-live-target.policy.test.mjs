import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const checker = fileURLToPath(
  new URL('../quality/verify-media-gcs-live-preconditions.mjs', import.meta.url)
);

const safeDefaults = {
  GOOGLE_CLOUD_PROJECT: 'media-sandbox-project',
  MEDIA_GCS_LIVE_TEST_PROJECT_NUMBER: '123456789012',
  MEDIA_GCS_LIVE_TEST_BUCKET: 'media-sandbox-isolated',
  MEDIA_GCS_LIVE_ACK: 'WRITE_ISOLATED_TEST_OBJECTS',
};

function expectPreflightDenial(overrides, message) {
  const env = {
    ...process.env,
    ...safeDefaults,
    ...overrides,
  };
  delete env.FIREBASE_STORAGE_EMULATOR_HOST;
  delete env.STORAGE_EMULATOR_HOST;
  delete env.FIREBASE_EMULATOR_HUB;
  delete env.FUNCTIONS_EMULATOR;

  const child = spawnSync(process.execPath, [checker], {
    env: { ...env, ...overrides },
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.notEqual(child.status, 0, 'an invalid real-GCS target must be rejected');
  assert.match(child.stderr, message);
}

describe('Media G4 live storage fail-closed target policy', () => {
  it('requires explicit acknowledgement', () => {
    expectPreflightDenial({ MEDIA_GCS_LIVE_ACK: '' }, /Explicit MEDIA_GCS_LIVE_ACK/);
  });

  it('rejects buckets that are not designated for testing', () => {
    expectPreflightDenial(
      { MEDIA_GCS_LIVE_TEST_BUCKET: 'media-production' },
      /dedicated non-production test bucket/
    );
  });

  it('requires an explicit project identifier', () => {
    expectPreflightDenial({ GOOGLE_CLOUD_PROJECT: '' }, /GOOGLE_CLOUD_PROJECT/);
  });

  it('requires a second project ownership check', () => {
    expectPreflightDenial(
      { MEDIA_GCS_LIVE_TEST_PROJECT_NUMBER: '' },
      /MEDIA_GCS_LIVE_TEST_PROJECT_NUMBER/
    );
  });

  it('rejects emulator configuration', () => {
    expectPreflightDenial(
      { FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199' },
      /refuses Firebase emulator/
    );
  });
});
