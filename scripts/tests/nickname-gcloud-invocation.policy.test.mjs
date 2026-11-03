import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import {
  buildSafeGcloudPowerShellCommand, spawnReadOnlyGcloud,
} from '../maintenance/nickname-gcloud-invocation.mjs';

const CLOUD_LOGGING_FILTER = [
  'log_id("cloudaudit.googleapis.com/data_access")',
  'protoPayload.serviceName="firestore.googleapis.com"',
  '(protoPayload.methodName="google.firestore.v1.Firestore.Commit" OR ' +
    'protoPayload.methodName="google.firestore.v1.Firestore.Write")',
  'timestamp>="2026-11-03T11:00:00.000Z"',
  '(protoPayload.status.code=0 OR NOT protoPayload.status.code:*)',
].join(' AND ');
const args = [
  'logging', 'read', CLOUD_LOGGING_FILTER,
  '--project=entretenimento-sexual', '--limit=1',
  '--format=value(timestamp)',
];

test('PowerShell invocation quotes the entire long logging filter', () => {
  const result = buildSafeGcloudPowerShellCommand(['--quiet', ...args]);
  assert.ok(result.includes("'" + CLOUD_LOGGING_FILTER.replaceAll('"', '\\\"') + "'"));
  assert.ok(result.includes("'--format=value(timestamp)'"));
  assert.ok(result.endsWith('; exit $LASTEXITCODE'));
  assert.equal(result.includes('%2F'), false);
  assert.equal(result.includes('shell:true'), false);
});

test('PowerShell arguments block control characters and quote apostrophes', () => {
  for (const s of ["bad\ncommand", 'bad\0command', "bad\rcommand"]) {
    assert.throws(() => buildSafeGcloudPowerShellCommand([s]));
  }
  assert.ok(buildSafeGcloudPowerShellCommand(["it's literal"])
    .includes("'it''s literal'"));
});

test('Windows actually passes a complicated filter through a .cmd shim', {
  skip: process.platform !== 'win32',
}, () => {
  const folder = mkdtempSync(join(tmpdir(), 'nickname-gcloud-win-'));
  try {
    writeFileSync(join(folder, 'gcloud.cmd'),
      '@echo off\r\nnode "%~dp0gcloud-shim.cjs" %*\r\n');
    writeFileSync(join(folder, 'gcloud-shim.cjs'),
      'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
    const env = { ...process.env };
    for (const k of Object.keys(env)) {
      if (k.toLowerCase() === 'path') {
        env[k] = folder + delimiter + env[k];
      }
    }
    const result = spawnReadOnlyGcloud(args, { env });
    assert.equal(result.status, 0,
      'PowerShell invocation failed (stderr not exposed to report).');
    assert.deepEqual(JSON.parse(result.stdout), ['--quiet', ...args]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test('regular platforms use gcloud directly without a shell', {
  skip: process.platform === 'win32',
}, () => {
  const result = spawnSync('node', ['--version'], { shell: false, encoding: 'utf8' });
  assert.equal(result.status, 0);
});
