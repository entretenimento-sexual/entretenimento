import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertExternalPaymentEgressAllowed,
  assertExternalVideoEgressAllowed,
  assertCloudTasksEmulatorConfigured,
  assertFirebaseEmulatorDependenciesConfigured,
  isFunctionsEmulatorRuntime,
} from './functions-runtime.guard';

test('external payment egress remains permitted in cloud runtime', () => {
  const before = process.env.FUNCTIONS_EMULATOR;
  try {
    delete process.env.FUNCTIONS_EMULATOR;
    assert.equal(isFunctionsEmulatorRuntime(), false);
    assert.doesNotThrow(() => assertExternalPaymentEgressAllowed());
    process.env.FUNCTIONS_EMULATOR = 'false';
    assert.doesNotThrow(() => assertExternalPaymentEgressAllowed());
  } finally {
    if (before === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = before;
  }
});

test('external payment egress is blocked in Functions Emulator', () => {
  const before = process.env.FUNCTIONS_EMULATOR;
  try {
    process.env.FUNCTIONS_EMULATOR = 'true';
    assert.equal(isFunctionsEmulatorRuntime(), true);
    assert.throws(
      () => assertExternalPaymentEgressAllowed(),
      /external_payment_egress_blocked_in_emulator/
    );
  } finally {
    if (before === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = before;
  }
});

test('cloud runtime never requires local Firebase endpoints', () => {
  assert.doesNotThrow(() => assertFirebaseEmulatorDependenciesConfigured({}));
  assert.doesNotThrow(() => assertFirebaseEmulatorDependenciesConfigured({
    FUNCTIONS_EMULATOR: 'false',
  }));
});

test('Functions Emulator requires local Auth, Firestore and Storage before Admin SDK boot', () => {
  const base = {
    FUNCTIONS_EMULATOR: 'true',
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIRESTORE_EMULATOR_HOST: 'localhost:8080',
    FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9199',
  };
  assert.doesNotThrow(() => assertFirebaseEmulatorDependenciesConfigured(base));

  for (const name of [
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
  ]) {
    const missing = { ...base, [name]: '' };
    assert.throws(() => assertFirebaseEmulatorDependenciesConfigured(missing),
      new RegExp(name));
  }
});

test('Functions Emulator rejects nonlocal hosts and invalid ports', () => {
  const base = {
    FUNCTIONS_EMULATOR: 'true',
    FIREBASE_AUTH_EMULATOR_HOST: 'localhost:9099',
    FIRESTORE_EMULATOR_HOST: 'localhost:8080',
    FIREBASE_STORAGE_EMULATOR_HOST: 'localhost:9199',
  };
  for (const endpoint of ['firestore.googleapis.com:443', '0.0.0.0:8080',
    'localhost:0', 'localhost:65536', 'localhost:abc', 'localhost:8080/path']) {
    assert.throws(() => assertFirebaseEmulatorDependenciesConfigured({
      ...base,
      FIRESTORE_EMULATOR_HOST: endpoint,
    }), /FIRESTORE_EMULATOR_HOST/);
  }
});

test('Cloud Tasks egress requires a loopback emulator endpoint only in local runtime', () => {
  assert.doesNotThrow(() => assertCloudTasksEmulatorConfigured({}));
  assert.doesNotThrow(() => assertCloudTasksEmulatorConfigured({
    FUNCTIONS_EMULATOR: 'false',
  }));
  for (const host of ['127.0.0.1:9499', 'localhost:9499', '[::1]:9499']) {
    assert.doesNotThrow(() => assertCloudTasksEmulatorConfigured({
      FUNCTIONS_EMULATOR: 'true',
      CLOUD_TASKS_EMULATOR_HOST: host,
    }));
  }
  for (const host of ['', 'cloudtasks.googleapis.com:443', '0.0.0.0:9499',
    'localhost:0', 'localhost:65536', 'localhost:9499/path',
    'https://localhost:9499']) {
    assert.throws(() => assertCloudTasksEmulatorConfigured({
      FUNCTIONS_EMULATOR: 'true',
      CLOUD_TASKS_EMULATOR_HOST: host,
    }), /CLOUD_TASKS_EMULATOR_HOST/);
  }
});

test('Google Video Transcoder egress is blocked locally even with credentials', () => {
  const before = process.env.FUNCTIONS_EMULATOR;
  try {
    process.env.FUNCTIONS_EMULATOR = 'true';
    assert.throws(
      () => assertExternalVideoEgressAllowed(),
      /external_video_egress_blocked_in_emulator/
    );
    process.env.FUNCTIONS_EMULATOR = 'false';
    assert.doesNotThrow(() => assertExternalVideoEgressAllowed());
  } finally {
    if (before === undefined) delete process.env.FUNCTIONS_EMULATOR;
    else process.env.FUNCTIONS_EMULATOR = before;
  }
});
