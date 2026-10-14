import assert from 'node:assert/strict';
import test from 'node:test';
import { assessEmulatorSuiteShutdown } from '../dev/emulator-suite-stop.policy.mjs';

const data = {
  hubPid: 200,
  projectId: 'entretenimento-sexual',
  processes: [
    { pid: 90, parentPid: 1, name: 'powershell.exe', commandLine: 'powershell' },
    { pid: 100, parentPid: 90, name: 'node.exe', commandLine: 'node scripts/dev/start-emulator-with-data.mjs' },
    { pid: 150, parentPid: 100, name: 'cmd.exe', commandLine: 'cmd /c npx firebase emulators:start' },
    { pid: 200, parentPid: 150, name: 'node.exe', commandLine: 'node firebase-tools/bin/firebase.js emulators:start --only auth,firestore,storage,functions --project entretenimento-sexual' },
    { pid: 300, parentPid: 200, name: 'java.exe', commandLine: 'java cloud-firestore-emulator-v1.jar' },
    { pid: 301, parentPid: 200, name: 'node.exe', commandLine: 'node firebase-functions' },
  ],
  listeners: [
    { port: 4400, pid: 200 },
    { port: 9099, pid: 200 },
    { port: 9199, pid: 200 },
    { port: 5001, pid: 200 },
    { port: 8080, pid: 300 },
  ],
};

test('recognizes only canonical launcher-owned emulator suite', () => {
  assert.equal(assessEmulatorSuiteShutdown(data), null);
});

for (const [label, change] of [
  ['hub PID mismatch', { hubPid: 201 }],
  ['other project', { projectId: 'unrelated' }],
  ['missing launcher parent', { processes: data.processes.filter(p => p.pid !== 100) }],
  ['foreign listener on emulated port', { listeners: [...data.listeners, { port: 5001, pid: 90 }] }],
  ['unrecognized child process', { processes: [...data.processes, { pid: 400, parentPid: 200, name: 'chrome.exe', commandLine: 'chrome' }] }],
  ['wrong Hub port owner', { listeners: data.listeners.map(p => p.port === 4400 ? { ...p, pid: 90 } : p) }],
  ['wrong CLI command line', { processes: data.processes.map(p => p.pid === 200 ? { ...p, commandLine: 'node other-script.js' } : p) }],
]) {
  test('refuses termination on ' + label, () => {
    assert.notEqual(assessEmulatorSuiteShutdown({ ...data, ...change }), null);
  });
}
