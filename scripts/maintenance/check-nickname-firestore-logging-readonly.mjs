// Opt-in read-only gcloud preflight. Does not enable logging, write Firestore,
// change IAM, deploy Functions/Rules, or output raw log entries/principal data.
import { spawnSync } from 'node:child_process';
import {
  assessNicknameFirestoreLoggingPreflight, FIRESTORE_WRITE_METHODS,
  classifyNicknameLoggingCliFailure,
} from './nickname-firestore-logging-preflight.policy.mjs';

const projectId = String(process.env.FIREBASE_PROJECT_ID ?? '').trim();
if (!/^[a-z0-9][a-z0-9-]{3,62}$/.test(projectId) || projectId.startsWith('demo-')) {
  throw new Error('Defina FIREBASE_PROJECT_ID com o projeto autorizado.');
}
if (process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Pré-diagnóstico de Cloud Logging não é compatível com emulador.');
}
const sources = {};
const binary = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';

function runGcloud(name, args) {
  const result = spawnSync(binary, ['--quiet', ...args], {
    encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
    shell: process.platform === 'win32', windowsHide: true,
  });
  sources[name] = result.error || result.status !== 0
    ? classifyNicknameLoggingCliFailure({
      errorCode: result.error?.code,
      stderr: result.stderr,
      signal: result.signal,
    })
    : 'ok';
  // Never forward potentially sensitive CLI error output or Cloud logs.
  return sources[name] === 'ok' ? result.stdout.trim() : null;
}
function readJson(name, args) {
  const output = runGcloud(name, [...args, '--format=json']);
  if (output === null) return null;
  try { return JSON.parse(output); } catch {
    sources[name] = 'invalid_response';
    return null;
  }
}

const iamPolicy = readJson('iamPolicy', [
  'projects', 'get-iam-policy', projectId,
]);
// gcloud does not have a "logging exclusions list" command. The _Default
// sink exposes its configured exclusions and disabled flag via read-only GET.
const defaultSink = readJson('exclusions', [
  'logging', 'sinks', 'describe', '_Default', '--project=' + projectId,
]);
const exclusions = defaultSink &&
  (!Object.hasOwn(defaultSink, 'exclusions') ||
    Array.isArray(defaultSink.exclusions))
  ? (defaultSink.exclusions ?? []) : null;
const defaultBucket = readJson('defaultBucket', [
  'logging', 'buckets', 'describe', '_Default',
  '--location=global', '--project=' + projectId,
]);

// The only field returned from query results is timestamp. Do not retrieve
// JWTs, UID, IP, request body, resourceName, or other log contents.
const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const methods = FIRESTORE_WRITE_METHODS.map(method =>
  'protoPayload.methodName="' + method + '"').join(' OR ');
const commonFilter = [
  'logName:"cloudaudit.googleapis.com%2Fdata_access"',
  'protoPayload.serviceName="firestore.googleapis.com"',
  '(' + methods + ')',
  'timestamp>="' + since + '"',
].join(' AND ');
function sample(name, condition) {
  const output = runGcloud(name, [
    'logging', 'read', commonFilter + ' AND ' + condition,
    '--project=' + projectId, '--limit=1', '--format=value(timestamp)',
  ]);
  return output === null ? null : output.length > 0;
}
// A generic non-PERMISSION_DENIED status is not a successful write.
// Query only explicit code zero or absent status; controlled allowed-write
// validation still remains mandatory for D0.
const writeSample = sample('writeSample',
  '(protoPayload.status.code=0 OR NOT protoPayload.status.code:*)');
const deniedSample = sample('deniedSample', 'protoPayload.status.code=7');

const report = assessNicknameFirestoreLoggingPreflight({
  projectId, iamPolicy, exclusions, defaultBucket, defaultSink,
  writeSample, deniedSample, sourceReads: sources,
});
console.log(JSON.stringify(report, null, 2));
// Diagnostic preflight never marks a live cutover GO or REVIEW_READY.
process.exitCode = 2;
