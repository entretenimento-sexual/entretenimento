import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  findEmulatorCredentialRisks,
  assertEmulatorCredentialsIsolated,
} from '../dev/emulator-credential-preflight.mjs';

function temporary(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'credential-preflight-'));
  try { return run(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function adc(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'application_default_credentials.json'), '{"private_key":"never-log-this"}');
}

test('credential-free session is accepted', () => temporary(root => {
  const opts = { env: { HOME: root }, platform: 'linux' };
  assert.deepEqual(findEmulatorCredentialRisks(opts), []);
  assert.doesNotThrow(() => assertEmulatorCredentialsIsolated(opts));
}));

test('credential environment values fail closed without printing secrets', () => temporary(root => {
  for (const key of [
    'GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_OAUTH_ACCESS_TOKEN',
    'GOOGLE_ACCESS_TOKEN', 'GOOGLE_CLOUD_CREDENTIALS',
    'FIREBASE_TOKEN', 'FIREBASE_CI_TOKEN', 'CLOUDSDK_AUTH_ACCESS_TOKEN',
  ]) {
    const opts = { env: { HOME: root, [key]: 'secret-example-value' }, platform: 'linux' };
    assert.deepEqual(findEmulatorCredentialRisks(opts), [`variável ${key}`]);
    assert.throws(() => assertEmulatorCredentialsIsolated(opts), error => {
      assert.match(error.message, new RegExp(key));
      assert.doesNotMatch(error.message, /secret-example-value/);
      return true;
    });
  }
}));

test('finds standard Linux/macOS ADC file without reading its content', () => temporary(root => {
  adc(path.join(root, '.config', 'gcloud'));
  assert.deepEqual(findEmulatorCredentialRisks({ env: { HOME: root }, platform: 'linux' }),
    ['arquivo ADC local do gcloud']);
}));

test('finds Windows APPDATA ADC file', () => temporary(root => {
  adc(path.join(root, 'gcloud'));
  assert.deepEqual(findEmulatorCredentialRisks({ env: { APPDATA: root }, platform: 'win32' }),
    ['arquivo ADC local do gcloud']);
}));

test('uses Windows USERPROFILE fallback', () => temporary(root => {
  adc(path.join(root, 'AppData', 'Roaming', 'gcloud'));
  assert.deepEqual(findEmulatorCredentialRisks({ env: { USERPROFILE: root }, platform: 'win32' }),
    ['arquivo ADC local do gcloud']);
}));

test('an empty isolated CLOUDSDK_CONFIG shadows the usual ADC location', () => temporary(root => {
  adc(path.join(root, '.config', 'gcloud'));
  const alternate = path.join(root, 'isolated');
  fs.mkdirSync(alternate);
  const opts = { env: { HOME: root, CLOUDSDK_CONFIG: alternate }, platform: 'linux' };
  assert.deepEqual(findEmulatorCredentialRisks(opts), []);
}));

test('an ADC inside CLOUDSDK_CONFIG is blocked', () => temporary(root => {
  adc(root);
  assert.deepEqual(findEmulatorCredentialRisks({
    env: { CLOUDSDK_CONFIG: root }, platform: 'win32',
  }), ['arquivo ADC local do gcloud']);
}));

test('failed ADC inspection fails closed without leaking paths', () => temporary(root => {
  assert.throws(() => assertEmulatorCredentialsIsolated({
    env: { HOME: root }, platform: 'linux',
    isFile: () => { throw new Error('SECRET PATH'); },
  }), error => {
    assert.match(error.message, /Falha ao verificar/);
    assert.doesNotMatch(error.message, /SECRET PATH/);
    return true;
  });
}));

test('credential preflight never changes existing ADC data', () => temporary(root => {
  const dir = path.join(root, 'gcloud');
  adc(dir);
  const filename = path.join(dir, 'application_default_credentials.json');
  const before = fs.readFileSync(filename, 'utf8');
  assert.throws(() => assertEmulatorCredentialsIsolated({ env: { APPDATA: root }, platform: 'win32' }));
  assert.equal(fs.readFileSync(filename, 'utf8'), before);
}));
